import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { StageResult } from '../../src/stages/types.js'
import type { PerformData } from '../../src/stages/import.js'
import type { USyncActionView } from '../../src/types/usync.js'
import { analyse } from '../../src/usync/analyse.js'
import {
  CONTENT_TYPE_ITEMS,
  IMPORT_STEP_RESPONSES,
  REPORT_RESPONSE,
  TEMPLATE_ITEMS
} from '../fixtures/usync-responses.js'

type Row = { data: string; header?: boolean }[]

const calls: { method: string; args: unknown[] }[] = []
const summary: Record<string, unknown> = {}
for (const method of [
  'addHeading',
  'addRaw',
  'addTable',
  'addList',
  'addDetails',
  'addEOL'
]) {
  summary[method] = jest.fn((...args: unknown[]) => {
    calls.push({ method, args })
    return summary
  })
}
summary.write = jest.fn(async () => summary)

jest.unstable_mockModule('@actions/core', () => ({ summary }))

const { writeSummary } = await import('../../src/report/summary.js')

beforeEach(() => {
  calls.length = 0
})

const tables = () =>
  calls.filter((c) => c.method === 'addTable').map((c) => c.args[0] as Row[])
const flat = () => JSON.stringify(calls)

function perform(
  actions: USyncActionView[],
  status = IMPORT_STEP_RESPONSES[2].status ?? []
): PerformData {
  return {
    result: {} as PerformData['result'],
    analysis: analyse(actions, status)
  }
}

const stage = (
  id: StageResult['id'],
  status: StageResult['status'],
  data?: unknown,
  title = id,
  text = `${id} summary`
): StageResult => ({ id, title, status, summary: text, data })

const site = {
  set: 'Default',
  umbracoVersion: '17.4.0',
  usyncVersion: '17.5.0'
}

describe('writeSummary', () => {
  it('writes the heading, site line and stage table, then the summary', async () => {
    await writeSummary(
      [
        stage('connect', 'success'),
        stage('import', 'skipped'),
        stage('report', 'warning'),
        stage('export', 'failed')
      ],
      site,
      'https://example.com/base'
    )

    expect(calls[0]).toEqual({ method: 'addHeading', args: ['uSync', 1] })
    expect(calls[1].args[0]).toBe(
      '<p>Site: example.com · Umbraco 17.4.0 · uSync 17.5.0 · set Default</p>'
    )
    const rows = tables()[0]
    expect(rows[0].map((c) => c.data)).toEqual(['Stage', 'Status', 'Summary'])
    expect(rows.slice(1).map((r) => r[1].data)).toEqual([
      '✅ Success',
      '⏭️ Skipped',
      '⚠️ Warning',
      '❌ Failed'
    ])
    expect(summary.write).toHaveBeenCalled()
  })

  it('omits unknown versions and falls back to the raw server value', async () => {
    await writeSummary([], { set: 'Live' }, 'not a url')
    expect(calls[1].args[0]).toBe('<p>Site: not a url · set Live</p>')
  })

  it('writes handler, failed-item and changed-item tables for an import', async () => {
    const data = perform([...CONTENT_TYPE_ITEMS, ...TEMPLATE_ITEMS])
    await writeSummary(
      [stage('import', 'failed', data, 'Import')],
      site,
      'https://example.com'
    )

    const [, handlers, failed, changed] = tables()
    expect(handlers.map((r) => r.map((c) => c.data))).toEqual([
      ['Handler', 'Changes', 'Errors'],
      ['Data Types', '1', '0'],
      ['Content Types', '1', '0'],
      ['Templates', '0', '1']
    ])
    expect(failed[1].map((c) => c.data)).toEqual([
      'Templates',
      'Broken template',
      'ImportFail',
      'Could not compile the template'
    ])
    expect(changed[0].map((c) => c.data)).toEqual(['Handler', 'Item', 'Change'])
    expect(changed[1].map((c) => c.data)).toEqual([
      'Content Types',
      'Home page',
      'Import'
    ])
  })

  it('shows property diffs for pending changes in a report', async () => {
    const data = perform(
      REPORT_RESPONSE.actions ?? [],
      REPORT_RESPONSE.status ?? []
    )
    await writeSummary(
      [stage('report', 'warning', data, 'Report')],
      site,
      'https://example.com'
    )

    const changed = tables()[2]
    expect(changed[0].map((c) => c.data)).toEqual([
      'Handler',
      'Item',
      'Change',
      'Details'
    ])
    const article = changed.find((r) => r[1].data === 'Article')
    expect(article?.[3].data).toBe(
      'Info/Name: Article → News article<br>Info/Description: (none) → Used for news'
    )
    const footer = changed.find((r) => r[1].data === 'Footer')
    expect(footer?.[3].data).toBe(
      'Content: &lt;footer&gt;old&lt;/footer&gt; → &lt;footer&gt;new&lt;/footer&gt;'
    )
    // Items without details get an empty cell
    expect(changed.find((r) => r[1].data === 'New block')?.[3].data).toBe('')
  })

  it('escapes every server-provided string', async () => {
    const evil = '<img src=x onerror="alert(1)">'
    const item: USyncActionView = {
      key: 'k',
      name: evil,
      handler: evil,
      itemType: 'IDataType',
      change: 'ImportFail',
      success: false,
      message: evil,
      details: [
        {
          success: false,
          name: evil,
          path: evil,
          oldValue: evil,
          newValue: evil,
          change: 'Update'
        }
      ]
    }
    const reportItem = { ...item, success: true, change: 'Update' as const }
    await writeSummary(
      [
        stage('import', 'failed', perform([item], []), evil, evil),
        stage('report', 'warning', perform([reportItem], []), evil),
        stage('rebuild-indexes', 'failed', {
          indexes: [{ name: evil, status: 'failed', error: evil }]
        }),
        stage('check-connections', 'warning', {
          servers: [
            {
              alias: evil,
              name: evil,
              url: evil,
              enabled: true,
              status: evil,
              message: evil,
              healthy: false
            }
          ]
        })
      ],
      { ...site, set: evil, umbracoVersion: evil, usyncVersion: evil },
      'https://example.com'
    )
    expect(flat()).not.toContain('<img')
    expect(flat()).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
  })

  it('truncates long values and collapses whitespace', async () => {
    const long = 'x'.repeat(500)
    const item: USyncActionView = {
      ...CONTENT_TYPE_ITEMS[0],
      details: [
        {
          success: true,
          name: 'n',
          path: 'p',
          oldValue: `a\n\n  b${long}`,
          newValue: undefined,
          change: 'Update'
        },
        {
          success: true,
          name: 'same',
          path: 'same',
          oldValue: 'v',
          newValue: 'v',
          change: 'NoChange'
        }
      ]
    }
    await writeSummary(
      [stage('report', 'warning', perform([item], []))],
      site,
      'https://example.com'
    )
    const details = tables()[2][1][3].data
    expect(details.startsWith('p: a b')).toBe(true)
    expect(details).toContain('… → (none)')
    expect(details).not.toContain('same')
    expect(details.length).toBeLessThan(260)
  })

  it('caps rows and property diffs with an "and N more" note', async () => {
    const many = (n: number, prefix: string): USyncActionView[] =>
      Array.from({ length: n }, (_, i) => ({
        ...CONTENT_TYPE_ITEMS[0],
        key: `${i}`,
        name: `${prefix}${i}`,
        details: Array.from({ length: 12 }, (_, d) => ({
          success: true,
          name: `d${d}`,
          path: `p${d}`,
          oldValue: 'a',
          newValue: 'b',
          change: 'Update' as const
        }))
      }))
    const failed = many(105, 'bad').map((i) => ({
      ...i,
      success: false,
      change: 'Fail' as const
    }))
    await writeSummary(
      [
        stage('report', 'failed', perform([...many(60, 'ok'), ...failed], [])),
        stage('check-connections', 'success', { servers: [] })
      ],
      site,
      'https://example.com'
    )
    const [, , failedTable, changedTable] = tables()
    expect(failedTable).toHaveLength(1 + 100 + 1)
    expect(failedTable.at(-1)?.map((c) => c.data)).toEqual([
      '…and 5 more',
      '',
      '',
      ''
    ])
    expect(changedTable).toHaveLength(1 + 50 + 1)
    expect(changedTable.at(-1)?.[0].data).toBe('…and 10 more')
    expect(changedTable[1][3].data).toContain('…and 2 more')
  })

  it('caps the handler table', async () => {
    const status = Array.from({ length: 101 }, (_, i) => ({
      name: `H${i}`,
      status: 'Complete' as const,
      changes: 0,
      inError: false
    }))
    await writeSummary(
      [stage('import', 'success', perform([], status))],
      site,
      'https://example.com'
    )
    expect(tables()[1]).toHaveLength(1 + 100 + 1)
  })

  it('omits empty sections and stages without data', async () => {
    await writeSummary(
      [
        stage('import', 'success', perform([], [])),
        stage('rebuild-cache', 'success', { durationMs: 1 }),
        stage('connect', 'success', { set: 'x' })
      ],
      site,
      'https://example.com'
    )
    // only the stage table
    expect(tables()).toHaveLength(1)
  })

  it('renders index results and connections without error text', async () => {
    await writeSummary(
      [
        stage('rebuild-indexes', 'warning', {
          indexes: [
            { name: 'A', status: 'requested' },
            { name: 'B', status: 'not-found' }
          ]
        }),
        stage('check-connections', 'success', {
          servers: [
            {
              alias: 'a',
              name: 'Staging',
              url: 'https://staging.example.com',
              enabled: true,
              status: 'Success',
              healthy: true
            }
          ]
        })
      ],
      site,
      'https://example.com'
    )
    const [, indexes, connections] = tables()
    expect(indexes.slice(1).map((r) => r.map((c) => c.data))).toEqual([
      ['A', 'requested'],
      ['B', 'not-found']
    ])
    expect(connections[1].map((c) => c.data)).toEqual([
      'Staging',
      'https://staging.example.com',
      'Success'
    ])
  })

  it('handles items without details or message', async () => {
    const bare = {
      key: 'k',
      name: 'Bare',
      handler: 'H',
      itemType: 'T',
      change: 'Update',
      success: true
    } as USyncActionView
    const bareFail = {
      ...bare,
      change: 'Fail',
      success: false
    } as USyncActionView
    await writeSummary(
      [stage('report', 'warning', perform([bare, bareFail], []))],
      site,
      'https://example.com'
    )
    const [, , failed, changed] = tables()
    expect(failed[1][3].data).toBe('')
    expect(changed[1][3].data).toBe('')
  })
})
