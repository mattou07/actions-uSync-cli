import { afterEach, describe, expect, it, jest } from '@jest/globals'
import { sleep } from '../../src/utils/sleep.js'

describe('sleep', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it('resolves only after the requested time has passed', async () => {
    jest.useFakeTimers()
    let resolved = false
    const promise = sleep(1000).then(() => {
      resolved = true
    })

    await jest.advanceTimersByTimeAsync(999)
    expect(resolved).toBe(false)

    await jest.advanceTimersByTimeAsync(1)
    await promise
    expect(resolved).toBe(true)
  })
})
