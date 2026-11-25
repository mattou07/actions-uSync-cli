import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { StageResult } from '../../src/stages/types.js'
import { analyse } from '../../src/usync/analyse.js'
import type { PerformData } from '../../src/stages/import.js'
import {
  CONTENT_TYPE_ITEMS,
  DATA_TYPE_ITEMS,
  REPORT_ACTIONS,
  TEMPLATE_ITEMS
} from '../fixtures/usync-responses.js'

const setOutput = jest.fn<(name: string, value: unknown) => void>()
jest.unstable_mockModule('@actions/core', () => ({ setOutput }))

const { setOutputs, writeResultsFile } =
  await import('../../src/report/outputs.js')

beforeEach(() => {
  jest.resetAllMocks()
})

function performData(
  actions: typeof DATA_TYPE_ITEMS,
  extra: Partial<PerformData> = {}
): PerformData {
  return {
    result: {} as PerformData['result'],
    analysis: analyse(actions, []),
    ...extra
  }
}

const outputs = () => Object.fromEntries(setOutput.mock.calls)

const result = (
  id: StageResult['id'],
  status: StageResult['status'],
  data?: unknown
): StageResult => ({ id, title: id, status, summary: `${id} summary`, data })

describe('setOutputs', () => {
  it('sets every output from the stage results', () => {
    setOutputs(
      [
        result('connect', 'success', {
          umbracoVersion: '17.4.0',
          usyncVersion: '17.5.0'
        }),
        result(
          'import',
          'failed',
          performData([
            ...DATA_TYPE_ITEMS,
            ...CONTENT_TYPE_ITEMS,
            ...TEMPLATE_ITEMS
          ])
        ),
        result('pre-report', 'success', performData(REPORT_ACTIONS)),
        result(
          'report',
          'failed',
          performData(REPORT_ACTIONS, {
            unapplied: REPORT_ACTIONS.slice(0, 3)
          } as Partial<PerformData>)
        ),
        result(
          'export',
          'success',
          performData([], { artifactName: 'usync-export' })
        ),
        result('check-connections', 'warning', {
          servers: [
            {
              alias: 'staging',
              name: 'Staging',
              url: 'https://staging.example.com',
              enabled: true,
              status: 'Success',
              healthy: true
            },
            {
              alias: 'live',
              name: 'Live',
              url: 'https://live.example.com',
              enabled: true,
              status: 'Error',
              message: 'timed out',
              healthy: false
            }
          ]
        })
      ],
      '/tmp/usync-results.json'
    )

    const o = outputs()
    expect(o.success).toBe('false')
    expect(JSON.parse(o.stages as string)).toEqual([
      { id: 'connect', status: 'success', summary: 'connect summary' },
      { id: 'import', status: 'failed', summary: 'import summary' },
      { id: 'pre-report', status: 'success', summary: 'pre-report summary' },
      { id: 'report', status: 'failed', summary: 'report summary' },
      { id: 'export', status: 'success', summary: 'export summary' },
      {
        id: 'check-connections',
        status: 'warning',
        summary: 'check-connections summary'
      }
    ])
    expect(o['imported-changes']).toBe('2')
    expect(o['import-errors']).toBe('1')
    expect(o['pending-changes']).toBe('4')
    expect(o['pre-import-changes']).toBe('4')
    expect(o['unapplied-changes']).toBe('3')
    expect(o.warnings).toBe('1')
    expect(o['umbraco-version']).toBe('17.4.0')
    expect(o['usync-version']).toBe('17.5.0')
    expect(o['export-artifact']).toBe('usync-export')
    expect(JSON.parse(o.connections as string)).toEqual([
      {
        alias: 'staging',
        name: 'Staging',
        url: 'https://staging.example.com',
        status: 'Success'
      },
      {
        alias: 'live',
        name: 'Live',
        url: 'https://live.example.com',
        status: 'Error'
      }
    ])
    expect(o['connection-errors']).toBe('1')
    expect(o['results-file']).toBe('/tmp/usync-results.json')
  })

  it('uses empty values for stages that did not run', () => {
    setOutputs(
      [
        result('connect', 'success', {}),
        result('import', 'skipped'),
        result('check-connections', 'skipped')
      ],
      ''
    )
    const o = outputs()
    expect(o.success).toBe('true')
    for (const name of [
      'imported-changes',
      'import-errors',
      'pending-changes',
      'pre-import-changes',
      'unapplied-changes',
      'warnings',
      'umbraco-version',
      'usync-version',
      'export-artifact',
      'connections',
      'connection-errors',
      'results-file'
    ]) {
      expect(o[name]).toBe('')
    }
  })

  it('leaves the export artifact empty when nothing was uploaded', () => {
    setOutputs([result('export', 'success', performData([]))], 'f')
    expect(outputs()['export-artifact']).toBe('')
    expect(outputs().warnings).toBe('0')
  })
})

describe('writeResultsFile', () => {
  it('writes the full results as JSON into the temp dir', async () => {
    const dir = join(await mkdtemp(join(tmpdir(), 'usync-results-')), 'nested')
    const results = [result('connect', 'success', { set: 'Default' })]

    const file = await writeResultsFile(results, dir)

    expect(file).toBe(join(dir, 'usync-results.json'))
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(results)
    await rm(join(dir, '..'), { recursive: true, force: true })
  })
})
