import { describe, expect, it } from '@jest/globals'
import {
  ERROR_CHANGES,
  NON_CHANGES,
  analyse,
  handlerLabel,
  isChangeAction,
  isErrorAction
} from '../../src/usync/analyse.js'
import type {
  ChangeType,
  SyncHandlerSummary,
  USyncActionView,
  USyncChange
} from '../../src/types/usync.js'
import {
  IMPORT_STEP_RESPONSES,
  REPORT_RESPONSE
} from '../fixtures/usync-responses.js'

const item = (
  change: ChangeType,
  overrides: Partial<USyncActionView> = {}
): USyncActionView => ({
  key: 'k',
  name: 'Item',
  handler: 'Data Types',
  itemType: 'IDataType',
  change,
  success: true,
  details: [],
  ...overrides
})

const detail = (change: USyncChange['change']): USyncChange => ({
  success: true,
  name: 'd',
  path: 'p',
  change
})

const summary = (
  name: string,
  changes: number,
  inError = false
): SyncHandlerSummary => ({ name, status: 'Complete', changes, inError })

describe('classification', () => {
  it('treats ERROR_CHANGES as errors even when success is true', () => {
    for (const change of ERROR_CHANGES) {
      expect(isErrorAction(item(change))).toBe(true)
      expect(isChangeAction(item(change))).toBe(false)
    }
  })

  it('treats success === false as an error whatever the change type', () => {
    expect(isErrorAction(item('Update', { success: false }))).toBe(true)
    expect(isChangeAction(item('Update', { success: false }))).toBe(false)
  })

  it('does not treat Clean and Removed as errors', () => {
    for (const change of ['Clean', 'Removed'] as const) {
      expect(isErrorAction(item(change))).toBe(false)
      expect(isChangeAction(item(change))).toBe(true)
    }
  })

  it('does not count NON_CHANGES as changes', () => {
    for (const change of NON_CHANGES) {
      expect(isErrorAction(item(change))).toBe(false)
      expect(isChangeAction(item(change))).toBe(false)
    }
  })

  it('counts real changes', () => {
    for (const change of [
      'Create',
      'Import',
      'Export',
      'Update',
      'Delete',
      'WillChange',
      'Rolledback'
    ] as const) {
      expect(isChangeAction(item(change))).toBe(true)
    }
  })
})

describe('analyse', () => {
  it('returns an empty analysis for null or undefined inputs', () => {
    const empty = {
      total: 0,
      changes: [],
      errors: [],
      warnings: [],
      handlers: []
    }
    expect(analyse(undefined, undefined)).toEqual(empty)
    expect(analyse(null, null)).toEqual(empty)
    expect(analyse([], [])).toEqual(empty)
  })

  it('separates errors, changes and non-changes', () => {
    const ok = item('NoChange')
    const created = item('Create')
    const failed = item('ImportFail', { success: false })
    const hidden = item('Hidden')
    const info = item('Information')
    const analysis = analyse([ok, created, failed, hidden, info], [])
    expect(analysis.total).toBe(5)
    expect(analysis.changes).toEqual([created])
    expect(analysis.errors).toEqual([failed])
  })

  it('collects warnings from details on any item, including errors', () => {
    const warned = item('Update', {
      details: [detail('Update'), detail('Warning')]
    })
    const failed = item('Fail', { details: [detail('Warning')] })
    const nullDetails = item('Create', { details: null })
    const noDetails = item('Create', { details: undefined })
    const analysis = analyse([warned, failed, nullDetails, noDetails], [])
    expect(analysis.warnings).toEqual([
      { item: warned, detail: warned.details?.[1] },
      { item: failed, detail: failed.details?.[0] }
    ])
  })

  it('takes handlers from the status only, carrying changes and inError', () => {
    const analysis = analyse(
      [item('Create', { handler: 'A' }), item('Fail', { handler: 'B' })],
      [summary('A', 7), summary('B', 3), summary('C', 0, true)]
    )
    expect(analysis.handlers).toEqual([
      { name: 'A', changes: 7, inError: false },
      { name: 'B', changes: 3, inError: false },
      { name: 'C', changes: 0, inError: true }
    ])
  })

  it('does not invent handler rows from item handler aliases', () => {
    const analysis = analyse(
      [
        item('Update', { handler: 'ContentHandler' }),
        item('Fail', { handler: 'TemplateHandler' })
      ],
      [summary('Content', 1), summary('Templates', 0)]
    )
    expect(analysis.handlers.map((h) => h.name)).toEqual([
      'Content',
      'Templates'
    ])
    expect(analysis.handlers.every((h) => h.inError === false)).toBe(true)
  })

  it('analyses the import fixture', () => {
    const last = IMPORT_STEP_RESPONSES[IMPORT_STEP_RESPONSES.length - 1]
    const analysis = analyse(last.actions, last.status)
    expect(analysis.total).toBe(4)
    expect(analysis.errors.map((e) => e.name)).toEqual(['Broken template'])
    expect(analysis.changes.map((c) => c.name)).toEqual([
      'Richtext editor',
      'Home page'
    ])
    expect(analysis.warnings).toHaveLength(1)
    expect(analysis.handlers.find((h) => h.name === 'Templates')).toEqual({
      name: 'Templates',
      changes: 0,
      inError: true
    })
  })

  it('analyses the report fixture', () => {
    const analysis = analyse(REPORT_RESPONSE.actions, REPORT_RESPONSE.status)
    expect(analysis.changes).toHaveLength(4)
    expect(analysis.errors).toHaveLength(0)
  })
})

describe('handlerLabel', () => {
  it('strips a trailing Handler from the alias', () => {
    expect(handlerLabel('ContentHandler')).toBe('Content')
    expect(handlerLabel('ContentTypeHandler')).toBe('ContentType')
  })

  it('leaves names without the suffix unchanged', () => {
    expect(handlerLabel('Data Types')).toBe('Data Types')
    expect(handlerLabel('HandlerContent')).toBe('HandlerContent')
    expect(handlerLabel('Handlers')).toBe('Handlers')
  })

  it('keeps a bare Handler as it is', () => {
    expect(handlerLabel('Handler')).toBe('Handler')
  })
})
