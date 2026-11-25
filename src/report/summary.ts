import * as core from '@actions/core'
import type { RebuildIndexesData } from '../stages/rebuild-indexes.js'
import type { CheckConnectionsData } from '../stages/check-connections.js'
import type { PerformData } from '../stages/import.js'
import type { ReportData } from '../stages/report.js'
import type { SiteInfo, StageResult, StageStatus } from '../stages/types.js'
import type { USyncActionView } from '../types/usync.js'
import { escapeHtml } from '../utils/safe-log.js'

const MAX_FAILED_ROWS = 100
const MAX_CHANGED_ROWS = 50
const MAX_HANDLER_ROWS = 100
const MAX_DIFFS_PER_ITEM = 10
const MAX_VALUE_LENGTH = 200
const MAX_NAME_LENGTH = 200
const MAX_MESSAGE_LENGTH = 500

const STATUS_LABEL: Record<StageStatus, string> = {
  success: '✅ Success',
  warning: '⚠️ Warning',
  failed: '❌ Failed',
  skipped: '⏭️ Skipped'
}

type Row = { data: string; header?: boolean }[]

/** Escaped, single-line, truncated text for a table cell. */
function cell(text: string | null | undefined, max: number): string {
  const single = (text ?? '').replace(/\s+/g, ' ').trim()
  const cut = single.length > max ? `${single.slice(0, max)}…` : single
  return escapeHtml(cut)
}

function headerRow(...titles: string[]): Row {
  return titles.map((data) => ({ data, header: true }))
}

function dataRow(...cells: string[]): Row {
  return cells.map((data) => ({ data }))
}

/** Rows capped at `max`, with a final "...and N more" row when cut. */
function capped<T>(
  items: T[],
  max: number,
  columns: number,
  toRow: (item: T) => string[]
): Row[] {
  const rows = items.slice(0, max).map((item) => dataRow(...toRow(item)))
  if (items.length > max) {
    rows.push(
      dataRow(`…and ${items.length - max} more`, ...Array(columns - 1).fill(''))
    )
  }
  return rows
}

function diffText(item: USyncActionView): string {
  const details = (item.details ?? []).filter((d) => d.change !== 'NoChange')
  const lines = details.slice(0, MAX_DIFFS_PER_ITEM).map((d) => {
    const before = d.oldValue ? cell(d.oldValue, MAX_VALUE_LENGTH) : '(none)'
    const after = d.newValue ? cell(d.newValue, MAX_VALUE_LENGTH) : '(none)'
    return `${cell(d.path, MAX_NAME_LENGTH)}: ${before} → ${after}`
  })
  if (details.length > MAX_DIFFS_PER_ITEM) {
    lines.push(`…and ${details.length - MAX_DIFFS_PER_ITEM} more`)
  }
  return lines.join('<br>')
}

function addPerformSection(
  summary: typeof core.summary,
  stage: StageResult,
  data: PerformData
): void {
  const { analysis } = data
  summary.addHeading(escapeHtml(stage.title), 2)

  if (analysis.handlers.length > 0) {
    summary.addTable([
      headerRow('Handler', 'Changes', 'Errors'),
      ...capped(analysis.handlers, MAX_HANDLER_ROWS, 3, (h) => [
        cell(h.name, MAX_NAME_LENGTH),
        String(h.changes),
        String(h.errors)
      ])
    ])
  }

  if (analysis.errors.length > 0) {
    summary.addHeading('Failed items', 3)
    summary.addTable([
      headerRow('Handler', 'Item', 'Change', 'Message'),
      ...capped(analysis.errors, MAX_FAILED_ROWS, 4, (i) => [
        cell(i.handler, MAX_NAME_LENGTH),
        cell(i.name, MAX_NAME_LENGTH),
        escapeHtml(i.change),
        cell(i.message, MAX_MESSAGE_LENGTH)
      ])
    ])
  }

  if (analysis.changes.length > 0) {
    const withDiffs = stage.id === 'report' || stage.id === 'pre-report'
    summary.addHeading(withDiffs ? 'Pending changes' : 'Changed items', 3)
    summary.addTable([
      headerRow('Handler', 'Item', 'Change', ...(withDiffs ? ['Details'] : [])),
      ...capped(analysis.changes, MAX_CHANGED_ROWS, withDiffs ? 4 : 3, (i) => [
        cell(i.handler, MAX_NAME_LENGTH),
        cell(i.name, MAX_NAME_LENGTH),
        escapeHtml(i.change),
        ...(withDiffs ? [diffText(i)] : [])
      ])
    ])
  }

  if (stage.id === 'report') {
    const { unapplied, appeared } = data as ReportData
    addItemTable(summary, 'Not applied by the import', unapplied)
    addItemTable(summary, 'Appeared after the import', appeared)
  }
}

function addItemTable(
  summary: typeof core.summary,
  heading: string,
  items: USyncActionView[] | undefined
): void {
  if (!items || items.length === 0) return
  summary.addHeading(heading, 3)
  summary.addTable([
    headerRow('Handler', 'Item', 'Change'),
    ...capped(items, MAX_CHANGED_ROWS, 3, (i) => [
      cell(i.handler, MAX_NAME_LENGTH),
      cell(i.name, MAX_NAME_LENGTH),
      escapeHtml(i.change)
    ])
  ])
}

function siteLine(site: SiteInfo, server: string): string {
  let host = server
  try {
    host = new URL(server).host
  } catch {
    // keep the raw value
  }
  const parts = [`Site: ${escapeHtml(host)}`]
  if (site.umbracoVersion) {
    parts.push(`Umbraco ${escapeHtml(site.umbracoVersion)}`)
  }
  if (site.usyncVersion) parts.push(`uSync ${escapeHtml(site.usyncVersion)}`)
  parts.push(`set ${escapeHtml(site.set)}`)
  return `<p>${parts.join(' · ')}</p>`
}

/** Writes the job summary. Every server-provided string is HTML-escaped. */
export async function writeSummary(
  results: StageResult[],
  site: SiteInfo,
  server: string
): Promise<void> {
  const summary = core.summary
  summary.addHeading('uSync', 1)
  summary.addRaw(siteLine(site, server), true)

  summary.addTable([
    headerRow('Stage', 'Status', 'Summary'),
    ...results.map((r) =>
      dataRow(
        escapeHtml(r.title),
        STATUS_LABEL[r.status],
        cell(r.summary, MAX_MESSAGE_LENGTH)
      )
    )
  ])

  for (const stage of results) {
    if (!stage.data) continue
    if (
      stage.id === 'import' ||
      stage.id === 'pre-report' ||
      stage.id === 'report' ||
      stage.id === 'export'
    ) {
      addPerformSection(summary, stage, stage.data as PerformData)
    } else if (stage.id === 'rebuild-indexes') {
      const { indexes } = stage.data as RebuildIndexesData
      summary.addHeading(escapeHtml(stage.title), 2)
      summary.addTable([
        headerRow('Index', 'Result'),
        ...indexes.map((i) =>
          dataRow(
            cell(i.name, MAX_NAME_LENGTH),
            i.error
              ? `${escapeHtml(i.status)}: ${cell(i.error, MAX_MESSAGE_LENGTH)}`
              : escapeHtml(i.status)
          )
        )
      ])
    } else if (stage.id === 'check-connections') {
      const { servers } = stage.data as CheckConnectionsData
      summary.addHeading('Connected servers', 2)
      summary.addTable([
        headerRow('Server', 'URL', 'Status'),
        ...servers.map((s) =>
          dataRow(
            cell(s.name, MAX_NAME_LENGTH),
            cell(s.url, MAX_NAME_LENGTH),
            s.message
              ? `${escapeHtml(s.status)}: ${cell(s.message, MAX_MESSAGE_LENGTH)}`
              : escapeHtml(s.status)
          )
        )
      ])
    }
  }

  await summary.write()
}
