import { safeInfo } from '../utils/safe-log.js'
import type {
  PerformAction,
  PerformActionRequest,
  PerformActionResponse,
  SyncHandlerSummary,
  SyncOperationStatusResponse,
  SyncRunningOperationResponse,
  USyncActionView
} from '../types/usync.js'
import { formatDuration } from '../utils/duration.js'
import { sleep } from '../utils/sleep.js'

export interface PerformApi {
  perform(request: PerformActionRequest): Promise<PerformActionResponse>
  getOperationStatus(
    operationId: string
  ): Promise<SyncOperationStatusResponse | undefined>
  getRunning(): Promise<SyncRunningOperationResponse | undefined>
}

export interface PerformOptions {
  action: PerformAction
  set: string
  group: string
  force: boolean
  clean: boolean
  timeoutMs: number
  /** Safety cap on steps, default 200. */
  maxSteps?: number
  /** Background polling start interval, default 2000, x1.5 per poll, max 15000. */
  pollIntervalMs?: number
}

export interface PerformResult {
  action: PerformAction
  mode: 'normal' | 'background'
  requestId: string
  operationId?: string
  /** Background only: Success | Failed | Stale | NotFound | ... */
  operationStatus?: string
  succeeded: boolean
  status: SyncHandlerSummary[]
  actions: USyncActionView[]
  message?: string
  steps: number
  durationMs: number
}

/** The server says another run of this action is already in progress. */
export class USyncBusyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'USyncBusyError'
  }
}

const DEFAULT_MAX_STEPS = 200
const DEFAULT_POLL_INTERVAL_MS = 2000
const MAX_POLL_INTERVAL_MS = 15000
const POLL_BACKOFF = 1.5

type PartialResult = Omit<PerformResult, 'steps' | 'durationMs'>
type Outcome =
  { kind: 'done'; result: PartialResult } | { kind: 'busy'; message: string }

interface Run {
  options: PerformOptions
  deadline: number
  steps: number
}

/** Server-supplied names must not be able to start a workflow command. */
const logLine = safeInfo

class ProgressLogger {
  private readonly seen = new Map<string, string>()

  update(status: SyncHandlerSummary[] | null | undefined): void {
    for (const handler of status ?? []) {
      if (handler.status !== 'Complete' && handler.status !== 'Error') continue
      if (handler.status === 'Complete' && handler.changes === 0) continue
      if (this.seen.get(handler.name) === handler.status) continue
      this.seen.set(handler.name, handler.status)
      const outcome =
        handler.status === 'Error' ? 'finished with errors' : 'complete'
      logLine(`  ${handler.name}: ${outcome} (${handler.changes} changes)`)
    }
  }
}

/** Matches the backoffice UI: a run is in progress only when operationId is set. */
function isIdle(running: SyncRunningOperationResponse): boolean {
  return !running.operationId
}

function timeoutError(options: PerformOptions, what: string): Error {
  return new Error(
    `uSync ${options.action} ${what} did not finish within ${formatDuration(options.timeoutMs)}`
  )
}

function nextInterval(interval: number): number {
  return Math.min(interval * POLL_BACKOFF, MAX_POLL_INTERVAL_MS)
}

/**
 * Runs a uSync action the way the backoffice UI does: one POST per handler
 * step until `complete`, or polling `Status` when the server moves the run
 * to a background operation.
 */
export async function runPerform(
  api: PerformApi,
  options: PerformOptions
): Promise<PerformResult> {
  const start = Date.now()
  const run: Run = { options, deadline: start + options.timeoutMs, steps: 0 }
  let restarted = false

  for (;;) {
    const outcome = await runOnce(api, run)
    if (outcome.kind === 'done') {
      return {
        ...outcome.result,
        steps: run.steps,
        durationMs: Date.now() - start
      }
    }
    if (restarted) throw new USyncBusyError(outcome.message)
    await waitUntilIdle(api, run, outcome.message)
    restarted = true
  }
}

async function waitUntilIdle(
  api: PerformApi,
  run: Run,
  busyMessage: string
): Promise<void> {
  logLine(`uSync reports another run is in progress: ${busyMessage}`)
  let interval = run.options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  for (;;) {
    const running = await api.getRunning()
    if (!running) throw new USyncBusyError(busyMessage)
    if (isIdle(running)) return
    if (Date.now() > run.deadline) {
      throw timeoutError(run.options, 'wait for the running operation')
    }
    await sleep(interval)
    interval = nextInterval(interval)
  }
}

async function runOnce(api: PerformApi, run: Run): Promise<Outcome> {
  const { options } = run
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS
  const progress = new ProgressLogger()
  let requestId = ''

  for (let stepNumber = 0; ; stepNumber++) {
    if (stepNumber >= maxSteps) {
      throw new Error(
        `uSync ${options.action} exceeded ${maxSteps} steps without completing`
      )
    }
    if (Date.now() > run.deadline) throw timeoutError(options, 'run')

    const response = await api.perform({
      requestId,
      action: options.action,
      stepNumber,
      options: {
        clientId: '',
        force: options.force,
        clean: options.clean,
        files: false,
        group: options.group,
        set: options.set
      }
    })
    run.steps++
    requestId = response.requestId
    progress.update(response.status)

    if (response.inBackground && response.operationId) {
      const result = await pollBackground(
        api,
        run,
        progress,
        response,
        response.operationId
      )
      return { kind: 'done', result }
    }

    if (response.complete) {
      const actions = response.actions ?? []
      if (!response.inBackground && response.message && actions.length === 0) {
        return { kind: 'busy', message: response.message }
      }
      return {
        kind: 'done',
        result: {
          action: options.action,
          mode: 'normal',
          requestId,
          succeeded: true,
          status: response.status ?? [],
          actions,
          message: response.message ?? undefined
        }
      }
    }
  }
}

async function pollBackground(
  api: PerformApi,
  run: Run,
  progress: ProgressLogger,
  started: PerformActionResponse,
  operationId: string
): Promise<PartialResult> {
  const { options } = run
  let interval = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  let status = started.status ?? []
  let actions = started.actions ?? []
  logLine(`uSync ${options.action} is running in the background`)

  for (;;) {
    if (Date.now() > run.deadline) throw timeoutError(options, 'background run')
    await sleep(interval)
    interval = nextInterval(interval)

    const poll = await api.getOperationStatus(operationId)
    if (!poll) {
      throw new Error(
        'uSync started a background operation but this server does not expose the Status endpoint to follow it (upgrade uSync to 17.x or later)'
      )
    }
    status = poll.status ?? status
    actions = poll.actions ?? actions
    progress.update(poll.status)

    if (poll.complete) {
      return {
        action: options.action,
        mode: 'background',
        requestId: started.requestId,
        operationId,
        operationStatus: poll.operationStatus,
        succeeded: poll.operationStatus === 'Success',
        status,
        actions,
        message: poll.message ?? undefined
      }
    }
  }
}
