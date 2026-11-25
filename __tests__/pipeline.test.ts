import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { Stage, StageId } from '../src/stages/types.js'
import { makeContext } from './fixtures/stage-context.js'

const core = {
  info: jest.fn<(m: string) => void>(),
  startGroup: jest.fn<(m: string) => void>(),
  endGroup: jest.fn<() => void>()
}

jest.unstable_mockModule('@actions/core', () => core)

const { runPipeline } = await import('../src/pipeline.js')

beforeEach(() => {
  jest.resetAllMocks()
})

function stage(
  id: StageId,
  overrides: Partial<Stage> = {},
  title = `Title ${id}`
): Stage {
  return {
    id,
    title,
    enabled: () => true,
    run: jest.fn<Stage['run']>().mockResolvedValue({
      status: 'success',
      summary: `${id} done`,
      data: { id }
    }),
    ...overrides
  }
}

describe('runPipeline', () => {
  it('runs enabled stages in order inside log groups and stores the results', async () => {
    const { ctx } = makeContext()
    const a = stage('connect')
    const b = stage('import')

    const results = await runPipeline(ctx, [a, b])

    expect(results).toEqual([
      {
        id: 'connect',
        title: 'Title connect',
        status: 'success',
        summary: 'connect done',
        data: { id: 'connect' }
      },
      {
        id: 'import',
        title: 'Title import',
        status: 'success',
        summary: 'import done',
        data: { id: 'import' }
      }
    ])
    expect(core.startGroup.mock.calls).toEqual([
      ['Title connect'],
      ['Title import']
    ])
    expect(core.endGroup).toHaveBeenCalledTimes(2)
    expect(ctx.results.import).toBe(results[1])
    expect(core.info).toHaveBeenCalledWith(
      'Title connect: success - connect done'
    )
  })

  it('skips disabled stages without a group', async () => {
    const { ctx } = makeContext()
    const off = stage('report', { enabled: () => false })

    const [result] = await runPipeline(ctx, [off])

    expect(result).toMatchObject({ status: 'skipped', summary: 'Disabled' })
    expect(off.run).not.toHaveBeenCalled()
    expect(core.startGroup).not.toHaveBeenCalled()
  })

  it('uses the dynamic title when a stage has one', async () => {
    const { ctx } = makeContext()
    const s = stage('connect', { getTitle: () => 'Dynamic' })
    const [result] = await runPipeline(ctx, [s])
    expect(result.title).toBe('Dynamic')
    expect(core.startGroup).toHaveBeenCalledWith('Dynamic')
  })

  it('records a thrown error as a failure and carries on', async () => {
    const { ctx } = makeContext()
    const failing = stage('import', {
      run: jest.fn<Stage['run']>().mockRejectedValue(new Error('exploded'))
    })
    const next = stage('report')

    const results = await runPipeline(ctx, [failing, next])

    expect(results[0]).toMatchObject({ status: 'failed', summary: 'exploded' })
    expect(results[1].status).toBe('success')
    expect(core.endGroup).toHaveBeenCalledTimes(2)
  })

  it('handles non-Error throws', async () => {
    const { ctx } = makeContext()
    const failing = stage('import', {
      run: jest.fn<Stage['run']>().mockRejectedValue('text failure')
    })
    const [result] = await runPipeline(ctx, [failing])
    expect(result.summary).toBe('text failure')
  })

  it('stops after a failed stage that aborts, but still lists disabled ones as disabled', async () => {
    const { ctx } = makeContext()
    const connect = stage('connect', {
      abortOnFailure: true,
      run: jest.fn<Stage['run']>().mockResolvedValue({
        status: 'failed',
        summary: 'no site'
      })
    })
    const next = stage('import')
    const off = stage('report', { enabled: () => false })

    const results = await runPipeline(ctx, [connect, next, off])

    expect(results.map((r) => [r.status, r.summary])).toEqual([
      ['failed', 'no site'],
      ['skipped', 'Not run: Title connect failed'],
      ['skipped', 'Disabled']
    ])
    expect(next.run).not.toHaveBeenCalled()
  })

  it('does not abort when a non-aborting stage fails or an aborting one succeeds', async () => {
    const { ctx } = makeContext()
    const a = stage('connect', { abortOnFailure: true })
    const b = stage('import', {
      run: jest.fn<Stage['run']>().mockResolvedValue({
        status: 'failed',
        summary: 'bad'
      })
    })
    const c = stage('report')
    const results = await runPipeline(ctx, [a, b, c])
    expect(results.map((r) => r.status)).toEqual([
      'success',
      'failed',
      'success'
    ])
  })

  it('defaults to the real stage list', async () => {
    const t = makeContext({ wait: false })
    t.usync.getSettings.mockRejectedValue(new Error('no settings'))
    const results = await runPipeline(t.ctx)
    expect(results).toHaveLength(8)
    expect(results[0]).toMatchObject({ id: 'connect', status: 'failed' })
    expect(results[1]).toMatchObject({
      status: 'skipped',
      summary: 'Not run: Connect failed'
    })
  })
})
