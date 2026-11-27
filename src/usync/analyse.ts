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

/** One handler summary as reported by uSync (display names, e.g. `Media Types`). */
export interface HandlerResult {
  name: string
  changes: number
  inError: boolean
}

/**
 * Display label for an item's handler alias: `ContentHandler` -> `Content`.
 * Only for display; identity comparisons must keep using the raw value.
 */
export function handlerLabel(handler: string): string {
  return handler.replace(/(?<=.)Handler$/, '')
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

  // Handler summaries use display names while items use handler aliases, so
  // the two cannot be joined reliably: the table comes from the status only.
  const handlers: HandlerResult[] = (status ?? []).map((s) => ({
    name: s.name,
    changes: s.changes,
    inError: s.inError
  }))

  return {
    total: items.length,
    changes,
    errors,
    warnings,
    handlers
  }
}
