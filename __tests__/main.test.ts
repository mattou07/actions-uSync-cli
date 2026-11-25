import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest
} from '@jest/globals'
import { tmpdir } from 'node:os'
import type { ActionInputs } from '../src/inputs.js'
import type { StageContext, StageResult } from '../src/stages/types.js'
import { makeInputs } from './fixtures/stage-context.js'

const core = {
  setFailed: jest.fn<(m: string) => void>(),
  warning: jest.fn<(m: string) => void>()
}
const getInputs = jest.fn<() => ActionInputs>()
const runPipeline = jest.fn<(ctx: StageContext) => Promise<StageResult[]>>()
const setOutputs = jest.fn<(r: StageResult[], f: string) => void>()
const writeResultsFile =
  jest.fn<(r: StageResult[], dir: string) => Promise<string>>()
const writeSummary =
  jest.fn<(r: StageResult[], s: unknown, server: string) => Promise<void>>()
const uploadArtifact =
  jest.fn<
    (
      name: string,
      files: string[],
      root: string
    ) => Promise<{ id?: number; size?: number }>
  >()

jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('../src/inputs.js', () => ({ getInputs }))
jest.unstable_mockModule('../src/pipeline.js', () => ({ runPipeline }))
jest.unstable_mockModule('../src/report/outputs.js', () => ({
  setOutputs,
  writeResultsFile
}))
jest.unstable_mockModule('../src/report/summary.js', () => ({ writeSummary }))
jest.unstable_mockModule('@actions/artifact', () => ({
  DefaultArtifactClient: class {
    uploadArtifact = uploadArtifact
  }
}))

const { run } = await import('../src/main.js')

const ok = (id: StageResult['id']): StageResult => ({
  id,
  title: `T-${id}`,
  status: 'success',
  summary: ''
})
const failed = (id: StageResult['id']): StageResult => ({
  ...ok(id),
  status: 'failed'
})

const originalTemp = process.env.RUNNER_TEMP

beforeEach(() => {
  jest.resetAllMocks()
  getInputs.mockReturnValue(makeInputs())
  runPipeline.mockResolvedValue([ok('connect')])
  writeResultsFile.mockResolvedValue('/tmp/usync-results.json')
  writeSummary.mockResolvedValue()
  process.env.RUNNER_TEMP = '/runner/temp'
})

afterEach(() => {
  if (originalTemp === undefined) delete process.env.RUNNER_TEMP
  else process.env.RUNNER_TEMP = originalTemp
})

describe('run', () => {
  it('builds the context, runs the pipeline and reports', async () => {
    await run()

    const ctx = runPipeline.mock.calls[0][0]
    expect(ctx.tempDir).toBe('/runner/temp')
    expect(ctx.site).toEqual({ set: '' })
    expect(ctx.results).toEqual({})
    expect(ctx.umbraco).toBeDefined()
    expect(ctx.usync).toBeDefined()
    expect(ctx.publisher).toBeDefined()
    expect(writeResultsFile).toHaveBeenCalledWith(
      [ok('connect')],
      '/runner/temp'
    )
    expect(setOutputs).toHaveBeenCalledWith(
      [ok('connect')],
      '/tmp/usync-results.json'
    )
    expect(writeSummary).toHaveBeenCalledWith(
      [ok('connect')],
      ctx.site,
      'https://example.com'
    )
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('falls back to the OS temp dir', async () => {
    delete process.env.RUNNER_TEMP
    await run()
    expect(runPipeline.mock.calls[0][0].tempDir).toBe(tmpdir())
  })

  it('uploads artifacts through the artifact client', async () => {
    uploadArtifact.mockResolvedValue({ id: 7, size: 42 })
    await run()
    const ctx = runPipeline.mock.calls[0][0]

    const uploaded = await ctx.artifacts.upload('name', '/dir/a.zip', '/dir')

    expect(uploaded).toEqual({ id: 7, size: 42 })
    expect(uploadArtifact).toHaveBeenCalledWith('name', ['/dir/a.zip'], '/dir')
  })

  it('fails the action listing the failed stages', async () => {
    runPipeline.mockResolvedValue([
      failed('import'),
      ok('report'),
      failed('export')
    ])
    await run()
    expect(core.setFailed).toHaveBeenCalledWith(
      'uSync failed: T-import, T-export'
    )
  })

  it('warns instead of failing when writing the results, outputs or summary fails', async () => {
    writeResultsFile.mockRejectedValue(new Error('disk full'))
    setOutputs.mockImplementation(() => {
      throw new Error('no outputs')
    })
    writeSummary.mockRejectedValue('summary too big')

    await run()

    expect(setOutputs).toHaveBeenCalledWith([ok('connect')], '')
    expect(core.warning.mock.calls.map((c) => c[0])).toEqual([
      'Could not write the results file: disk full',
      'Could not set the outputs: no outputs',
      'Could not write the job summary: summary too big'
    ])
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('fails with the message when the inputs are invalid', async () => {
    getInputs.mockImplementation(() => {
      throw new Error('Nothing to do')
    })
    await run()
    expect(core.setFailed).toHaveBeenCalledWith('Nothing to do')
    expect(runPipeline).not.toHaveBeenCalled()
  })

  it('fails with the message on an unexpected pipeline error', async () => {
    runPipeline.mockRejectedValue(new Error('unexpected'))
    await run()
    expect(core.setFailed).toHaveBeenCalledWith('unexpected')
  })
})
