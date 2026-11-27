import * as core from '@actions/core'
import { ApiError } from '../api/http.js'
import type { RuntimeLevel } from '../types/umbraco.js'
import type { StartupStatusResponse } from '../types/usync.js'
import { formatDuration } from '../utils/duration.js'
import { safeInfo } from '../utils/safe-log.js'
import { sleep } from '../utils/sleep.js'
import type { Stage, StageContext, StageOutcome } from './types.js'
import { errorMessage } from './types.js'

export interface ConnectData {
  runtimeLevel?: RuntimeLevel
  umbracoVersion?: string
  usyncVersion?: string
  set: string
  processingMode?: string
  startupImport?: StartupStatusResponse | 'unsupported' | 'not-checked'
  waitedMs: number
}

const BAD_STARTUP_STATES = ['CompletedWithErrors', 'Failed', 'Blocked']

/** 2s, then 5s, then 10s between polls. */
function pollDelay(attempt: number): number {
  if (attempt === 0) return 2000
  if (attempt === 1) return 5000
  return 10000
}

/** Errors that mean the site is still starting up rather than a real problem. */
function isStartingUp(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true
  return error.status >= 500 || error.status === 404 || error.status === 429
}

class Waiter {
  private attempt = 0

  constructor(
    private readonly deadline: number,
    private readonly timeoutMs: number
  ) {}

  /** Throws when the deadline has passed, otherwise sleeps the next ramp step. */
  async pause(what: string): Promise<void> {
    if (Date.now() >= this.deadline) {
      throw new Error(
        `Timed out after ${formatDuration(this.timeoutMs)} waiting for ${what}`
      )
    }
    await sleep(pollDelay(this.attempt++))
  }
}

async function waitForRunLevel(
  ctx: StageContext,
  waiter: Waiter
): Promise<RuntimeLevel> {
  let last = 'unreachable'
  for (;;) {
    let level: RuntimeLevel | undefined
    try {
      level = (await ctx.umbraco.getServerStatus()).serverStatus
    } catch (error) {
      if (!isStartingUp(error)) throw error
      core.info(`Site not responding yet: ${errorMessage(error)}`)
    }
    if (level === 'Run') return level
    if (level === 'BootFailed') {
      throw new Error('Umbraco failed to boot (run level BootFailed)')
    }
    if (level) {
      last = level
      core.info(`Site run level is ${level}, waiting...`)
    }
    await waiter.pause(`the site to reach run level Run (last seen: ${last})`)
  }
}

async function loadSettings(ctx: StageContext): Promise<void> {
  try {
    ctx.site.settings = await ctx.usync.getSettings()
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) {
        throw new Error('API user is not authorised (401 from uSync Settings)')
      }
      if (error.status === 403) {
        throw new Error(
          "API user's group needs access to the Settings (or uSync) section"
        )
      }
      if (error.status === 404) {
        throw new Error('uSync is not installed on this site')
      }
    }
    throw error
  }
}

/** Drops SemVer build metadata (`17.8.2+6085291` -> `17.8.2`); prereleases stay. */
function stripBuildMetadata(version: string | undefined): string | undefined {
  return version?.split('+')[0]
}

async function bestEffort<T>(
  what: string,
  work: Promise<T>
): Promise<T | undefined> {
  try {
    return await work
  } catch (error) {
    core.debug(`Could not read ${what}: ${errorMessage(error)}`)
    return undefined
  }
}

/** Waits for a startup import to finish. Returns a warning if it did not go well. */
async function waitForStartupImport(
  ctx: StageContext,
  waiter: Waiter
): Promise<{ state: ConnectData['startupImport']; warning?: string }> {
  let status = await ctx.usync.getStartupStatus()
  while (status?.state === 'Running' && !status.isStale) {
    core.info('A uSync startup import is running, waiting...')
    await waiter.pause('the uSync startup import to finish')
    status = await ctx.usync.getStartupStatus()
  }
  if (!status) {
    core.info(
      'Startup import status is not available (needs uSync 17.6.3 or later), skipping'
    )
    return { state: 'unsupported' }
  }
  if (status.state === 'Running') {
    return {
      state: status,
      warning:
        'the uSync startup import looks stale (no progress reported); the import stage will re-run it'
    }
  }
  if (BAD_STARTUP_STATES.includes(status.state)) {
    return {
      state: status,
      warning: `the uSync startup import ended as ${status.state}; the import stage will report the items`
    }
  }
  return { state: status }
}

async function waitUntilIdle(ctx: StageContext, waiter: Waiter): Promise<void> {
  let running = await ctx.usync.getRunning()
  while (running?.operationId) {
    core.info('Another uSync operation is running, waiting...')
    await waiter.pause('the running uSync operation to finish')
    running = await ctx.usync.getRunning()
  }
}

async function run(ctx: StageContext): Promise<StageOutcome> {
  const { inputs, site } = ctx
  const start = Date.now()
  const timeoutMs = inputs.waitTimeoutMinutes * 60_000
  const waiter = new Waiter(start + timeoutMs, timeoutMs)
  const data: ConnectData = {
    set: '',
    startupImport: 'not-checked',
    waitedMs: 0
  }

  if (inputs.wait) {
    data.runtimeLevel = await waitForRunLevel(ctx, waiter)
  }

  await loadSettings(ctx)
  const settings = site.settings
  site.set = inputs.set || settings?.defaultSet || 'Default'
  data.set = site.set
  data.processingMode = settings?.processingMode

  const information = await bestEffort(
    'server information',
    ctx.umbraco.getServerInformation()
  )
  site.umbracoVersion = stripBuildMetadata(information?.version)
  site.usyncVersion = stripBuildMetadata(
    await bestEffort('uSync version', ctx.usync.getVersion())
  )
  data.umbracoVersion = site.umbracoVersion
  data.usyncVersion = site.usyncVersion

  let warning: string | undefined
  if (inputs.wait && inputs.waitForStartupImport) {
    const startup = await waitForStartupImport(ctx, waiter)
    data.startupImport = startup.state
    warning = startup.warning
  }
  if (inputs.wait) {
    await waitUntilIdle(ctx, waiter)
  }
  data.waitedMs = Date.now() - start

  const state = inputs.wait ? 'running' : 'reachable'
  const parts = [
    site.umbracoVersion
      ? `Umbraco ${site.umbracoVersion} is ${state}`
      : `Umbraco is ${state}`
  ]
  if (site.usyncVersion) parts.push(`uSync ${site.usyncVersion}`)
  parts.push(`set ${site.set}`)
  let summary = parts.join('; ')
  if (warning) summary += `; warning: ${warning}`
  safeInfo(summary)
  return { status: warning ? 'warning' : 'success', summary, data }
}

export const connectStage: Stage = {
  id: 'connect',
  title: 'Connect',
  getTitle: (inputs) => (inputs.wait ? 'Wait for site' : 'Connect'),
  enabled: () => true,
  abortOnFailure: true,
  run
}
