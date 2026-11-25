import type {
  ChangeType,
  SyncHandlerSummary,
  USyncActionView,
  USyncChange
} from '../types/usync.js'

/** Change types we treat as errors. Clean/Removed are deliberately not errors. */
export const ERROR_CHANGES: readonly ChangeType[] = [
  'Fail',
  'ImportFail',
  'Mismatch',
  'ParentMissing'
]

/** Change types that mean "nothing happened to this item". */
export const NON_CHANGES: readonly ChangeType[] = [
  'NoChange',
  'Hidden',
  'Information'
]

export interface ItemWarning {
  item: USyncActionView
  detail: USyncChange
}

export interface HandlerResult {
  name: string
  changes: number
  errors: number
  inError: boolean
}

export interface Analysis {
  total: number
  /** Not an error and the change is not in NON_CHANGES. */
  changes: USyncActionView[]
  /** success === false OR change in ERROR_CHANGES. */
  errors: USyncActionView[]
  /** Items with a detail of type Warning. */
  warnings: ItemWarning[]
  handlers: HandlerResult[]
}

export function isErrorAction(a: USyncActionView): boolean {
  return !a.success || ERROR_CHANGES.includes(a.change)
}

export function isChangeAction(a: USyncActionView): boolean {
  return !isErrorAction(a) && !NON_CHANGES.includes(a.change)
}

/** Summarises the cumulative actions/status returned by a uSync run. */
export function analyse(
  actions: USyncActionView[] | null | undefined,
  status: SyncHandlerSummary[] | null | undefined
): Analysis {
  const items = actions ?? []
  const errors = items.filter(isErrorAction)
  const changes = items.filter(isChangeAction)
  const warnings: ItemWarning[] = []
  for (const item of items) {
    for (const detail of item.details ?? []) {
      if (detail.change === 'Warning') warnings.push({ item, detail })
    }
  }

  const handlers = new Map<string, HandlerResult>()
  for (const s of status ?? []) {
    handlers.set(s.name, {
      name: s.name,
      changes: s.changes,
      errors: 0,
      inError: s.inError
    })
  }
  // Handlers the server never reported on get our own change count.
  const ownChanges = new Map<string, number>()
  for (const item of changes) {
    ownChanges.set(item.handler, (ownChanges.get(item.handler) ?? 0) + 1)
  }
  for (const item of items) {
    let handler = handlers.get(item.handler)
    if (!handler) {
      handler = {
        name: item.handler,
        changes: ownChanges.get(item.handler) ?? 0,
        errors: 0,
        inError: false
      }
      handlers.set(item.handler, handler)
    }
    if (isErrorAction(item)) {
      handler.errors += 1
      handler.inError = true
    }
  }

  return {
    total: items.length,
    changes,
    errors,
    warnings,
    handlers: [...handlers.values()]
  }
}
