import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { PerformResult } from '../../src/usync/perform.js'
import type { PerformData } from '../../src/stages/import.js'
import {
  BACKGROUND_START_RESPONSE,
  BACKGROUND_STATUS_FAILED,
  BACKGROUND_STATUS_STALE,
  CONTENT_TYPE_ITEMS,
  DATA_TYPE_ITEMS,
  EXPORT_RESPONSE,
  IMPORT_REQUEST_ID,
  IMPORT_STEP_RESPONSES,
  REPORT_RESPONSE
} from '../fixtures/usync-responses.js'
import { makeContext } from '../fixtures/stage-context.js'
import { ApiError } from '../../src/api/http.js'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const core = {
  info: jest.fn<(m: string) => void>(),
  warning: jest.fn<(m: string) => void>()
}
const sleep = jest.fn<(ms: number) => Promise<void>>()

jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('../../src/utils/sleep.js', () => ({ sleep }))

const { importStage, incompleteNote } =
  await import('../../src/stages/import.js')
const { reportStage } = await import('../../src/stages/report.js')
const { exportStage } = await import('../../src/stages/export.js')

beforeEach(() => {
  jest.resetAllMocks()
  sleep.mockResolvedValue()
})

const completeWith = (actions = DATA_TYPE_ITEMS) => ({
  requestId: IMPORT_REQUEST_ID,
  complete: true,
  status: [],
  actions
})

describe('importStage', () => {
  it('is enabled by the import input', () => {
    const { ctx } = makeContext()
    expect(importStage.enabled({ ...ctx.inputs, import: true })).toBe(true)
    expect(importStage.enabled({ ...ctx.inputs, import: false })).toBe(false)
  })

  it('fails when items fail to import and logs each one', async () => {
    const t = makeContext({ force: true, group: 'settings' })
    t.ctx.site.set = 'Live'
    t.usync.perform
      .mockResolvedValueOnce(IMPORT_STEP_RESPONSES[0])
      .mockResolvedValueOnce(IMPORT_STEP_RESPONSES[1])
      .mockResolvedValueOnce(IMPORT_STEP_RESPONSES[2])

    const outcome = await importStage.run(t.ctx)

    expect(outcome.status).toBe('failed')
    expect(outcome.summary).toBe('2 changes imported, 1 errors')
    expect(core.warning).toHaveBeenCalledWith(
      'Templates: Broken template (ImportFail) - Could not compile the template'
    )
    expect(t.usync.perform.mock.calls[0][0].options).toMatchObject({
      force: true,
      group: 'settings',
      set: 'Live',
      clean: false
    })
    expect(
      (outcome.data as PerformData).analysis.errors.map((e) => e.name)
    ).toEqual(['Broken template'])
  })

  it('succeeds when nothing is wrong, logging errors without a message plainly', async () => {
    const t = makeContext()
    t.usync.perform.mockResolvedValueOnce(completeWith())
    const outcome = await importStage.run(t.ctx)
    expect(outcome.status).toBe('success')
    expect(outcome.summary).toBe('1 changes imported, 0 errors')
  })

  it('warns when items carry warnings', async () => {
    const t = makeContext()
    t.usync.perform.mockResolvedValueOnce(completeWith(CONTENT_TYPE_ITEMS))
    const outcome = await importStage.run(t.ctx)
    expect(outcome.status).toBe('warning')
  })

  it('fails when a background operation does not succeed', async () => {
    const t = makeContext()
    t.usync.perform.mockResolvedValueOnce(BACKGROUND_START_RESPONSE)
    t.usync.getOperationStatus.mockResolvedValueOnce(BACKGROUND_STATUS_STALE)
    const outcome = await importStage.run(t.ctx)
    expect(outcome.status).toBe('failed')
    expect(outcome.summary).toBe(
      '0 changes imported, 0 errors (operation Stale: The operation stopped reporting progress)'
    )
  })

  it('logs failed items that have no message', async () => {
    const t = makeContext()
    t.usync.perform.mockResolvedValueOnce(BACKGROUND_START_RESPONSE)
    t.usync.getOperationStatus.mockResolvedValueOnce({
      ...BACKGROUND_STATUS_FAILED,
      actions: [{ ...DATA_TYPE_ITEMS[0], success: false, message: null }]
    })
    await importStage.run(t.ctx)
    expect(core.warning).toHaveBeenCalledWith(
      'Data Types: Richtext editor (Update)'
    )
  })
})

describe('incompleteNote', () => {
  const base: PerformResult = {
    action: 'Import',
    mode: 'background',
    requestId: 'r',
    succeeded: false,
    status: [],
    actions: [],
    steps: 1,
    durationMs: 1
  }

  it('is empty when the run succeeded', () => {
    expect(incompleteNote({ ...base, succeeded: true })).toBe('')
  })

  it('describes an incomplete run with and without detail', () => {
    expect(incompleteNote(base)).toBe(' (operation incomplete)')
    expect(
      incompleteNote({ ...base, operationStatus: 'Failed', message: 'nope' })
    ).toBe(' (operation Failed: nope)')
  })
})

describe('reportStage', () => {
  it('is enabled by the report input', () => {
    const { ctx } = makeContext()
    expect(reportStage.enabled({ ...ctx.inputs, report: false })).toBe(false)
    expect(reportStage.enabled({ ...ctx.inputs, report: true })).toBe(true)
  })

  it('succeeds with nothing pending', async () => {
    const t = makeContext()
    t.usync.perform.mockResolvedValueOnce(
      completeWith([{ ...DATA_TYPE_ITEMS[1] }])
    )
    const outcome = await reportStage.run(t.ctx)
    expect(outcome).toMatchObject({
      status: 'success',
      summary: 'No pending changes'
    })
  })

  it('warns about pending changes after an import and never forces', async () => {
    const t = makeContext({ force: true })
    t.ctx.results.import = {
      id: 'import',
      title: 'Import',
      status: 'success',
      summary: ''
    }
    t.usync.perform.mockResolvedValueOnce(REPORT_RESPONSE)
    const outcome = await reportStage.run(t.ctx)
    expect(outcome.status).toBe('warning')
    expect(outcome.summary).toBe('4 items still differ after import')
    expect(t.usync.perform.mock.calls[0][0].options.force).toBe(false)
  })

  it('describes a dry run when the import was skipped or absent', async () => {
    const t = makeContext()
    t.ctx.results.import = {
      id: 'import',
      title: 'Import',
      status: 'skipped',
      summary: 'Disabled'
    }
    t.usync.perform.mockResolvedValue(REPORT_RESPONSE)
    expect((await reportStage.run(t.ctx)).summary).toBe('4 pending changes')
    t.ctx.results = {}
    expect((await reportStage.run(t.ctx)).summary).toBe('4 pending changes')
  })

  it('fails on pending changes when fail-on-changes is set', async () => {
    const t = makeContext({ failOnChanges: true })
    t.usync.perform.mockResolvedValueOnce(REPORT_RESPONSE)
    expect((await reportStage.run(t.ctx)).status).toBe('failed')
  })

  it('does not fail on zero pending changes with fail-on-changes', async () => {
    const t = makeContext({ failOnChanges: true })
    t.usync.perform.mockResolvedValueOnce(completeWith([DATA_TYPE_ITEMS[1]]))
    expect((await reportStage.run(t.ctx)).status).toBe('success')
  })

  it('mentions errors and warnings', async () => {
    const t = makeContext()
    t.usync.perform.mockResolvedValueOnce(
      completeWith([
        ...CONTENT_TYPE_ITEMS,
        { ...DATA_TYPE_ITEMS[1], success: false, change: 'Fail' }
      ])
    )
    const outcome = await reportStage.run(t.ctx)
    expect(outcome.status).toBe('warning')
    expect(outcome.summary).toBe('1 pending changes, 1 errors, 1 warnings')
  })

  it('warns on errors alone and on warnings alone', async () => {
    const t = makeContext()
    t.usync.perform.mockResolvedValueOnce(
      completeWith([{ ...DATA_TYPE_ITEMS[1], success: false, change: 'Fail' }])
    )
    expect((await reportStage.run(t.ctx)).status).toBe('warning')
    t.usync.perform.mockResolvedValueOnce(
      completeWith([
        { ...DATA_TYPE_ITEMS[1], details: CONTENT_TYPE_ITEMS[0].details }
      ])
    )
    expect((await reportStage.run(t.ctx)).status).toBe('warning')
  })

  it('fails when a background report does not succeed', async () => {
    const t = makeContext()
    t.usync.perform.mockResolvedValueOnce(BACKGROUND_START_RESPONSE)
    t.usync.getOperationStatus.mockResolvedValueOnce(BACKGROUND_STATUS_STALE)
    expect((await reportStage.run(t.ctx)).status).toBe('failed')
  })
})

describe('exportStage', () => {
  it('is enabled by the export input', () => {
    const { ctx } = makeContext()
    expect(exportStage.enabled({ ...ctx.inputs, export: true })).toBe(true)
    expect(exportStage.enabled({ ...ctx.inputs, export: false })).toBe(false)
  })

  it('exports with clean and does not download by default', async () => {
    const t = makeContext({ exportClean: true })
    t.usync.perform.mockResolvedValueOnce(EXPORT_RESPONSE)
    const outcome = await exportStage.run(t.ctx)
    expect(outcome.status).toBe('success')
    expect(outcome.summary).toBe('3 items exported, 0 errors')
    expect(t.usync.perform.mock.calls[0][0].options.clean).toBe(true)
    expect(t.usync.download).not.toHaveBeenCalled()
  })

  it('fails when items fail to export', async () => {
    const t = makeContext({ downloadExport: true })
    t.usync.perform.mockResolvedValueOnce(
      completeWith([{ ...DATA_TYPE_ITEMS[0], success: false }])
    )
    t.usync.download.mockResolvedValueOnce(Buffer.from('zip'))
    t.ctx.tempDir = join(tmpdir(), 'usync-export-test-unused')
    const outcome = await exportStage.run(t.ctx)
    expect(outcome.status).toBe('failed')
    await rm(t.ctx.tempDir, { recursive: true, force: true })
  })

  describe('with download', () => {
    let dir: string
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'usync-export-'))
    })

    it('writes the zip and uploads it as an artifact', async () => {
      const t = makeContext(
        { downloadExport: true, exportArtifactName: 'my-export' },
        dir
      )
      t.usync.perform.mockResolvedValueOnce(EXPORT_RESPONSE)
      t.usync.download.mockResolvedValueOnce(Buffer.from('zip-bytes'))
      t.artifacts.upload.mockResolvedValueOnce({ id: 1, size: 9 })

      const outcome = await exportStage.run(t.ctx)

      const file = join(dir, 'usync-export', 'my-export.zip')
      expect(await readFile(file, 'utf8')).toBe('zip-bytes')
      expect(t.artifacts.upload).toHaveBeenCalledWith(
        'my-export',
        file,
        join(dir, 'usync-export')
      )
      expect(outcome.status).toBe('success')
      expect(outcome.data).toMatchObject({
        artifactName: 'my-export',
        zipBytes: 9
      })
      expect(outcome.summary).toContain('uploaded artifact my-export')
      await rm(dir, { recursive: true, force: true })
    })

    it('explains a 403 from the download', async () => {
      const t = makeContext({ downloadExport: true }, dir)
      t.usync.perform.mockResolvedValueOnce(EXPORT_RESPONSE)
      t.usync.download.mockRejectedValueOnce(
        new ApiError('forbidden', 403, 'POST', 'Download', '')
      )
      const outcome = await exportStage.run(t.ctx)
      expect(outcome.status).toBe('failed')
      expect(outcome.summary).toContain('admin group')
      expect(t.artifacts.upload).not.toHaveBeenCalled()
      await rm(dir, { recursive: true, force: true })
    })

    it('rethrows other download errors', async () => {
      const t = makeContext({ downloadExport: true }, dir)
      t.usync.perform.mockResolvedValue(EXPORT_RESPONSE)
      t.usync.download.mockRejectedValueOnce(
        new ApiError('boom', 500, 'POST', 'Download', '')
      )
      await expect(exportStage.run(t.ctx)).rejects.toThrow('boom')
      t.usync.download.mockRejectedValueOnce(new Error('network'))
      await expect(exportStage.run(t.ctx)).rejects.toThrow('network')
      await rm(dir, { recursive: true, force: true })
    })

    it('does not download when the export did not complete', async () => {
      const t = makeContext({ downloadExport: true }, dir)
      t.usync.perform.mockResolvedValueOnce(BACKGROUND_START_RESPONSE)
      t.usync.getOperationStatus.mockResolvedValueOnce(BACKGROUND_STATUS_STALE)
      const outcome = await exportStage.run(t.ctx)
      expect(outcome.status).toBe('failed')
      expect(t.usync.download).not.toHaveBeenCalled()
      await rm(dir, { recursive: true, force: true })
    })
  })
})
