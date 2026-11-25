import { describe, expect, it } from '@jest/globals'
import { formatDuration } from '../../src/utils/duration.js'

describe('formatDuration', () => {
  it.each([
    [0, '0s'],
    [-5000, '0s'],
    [499, '0s'],
    [45000, '45s'],
    [59400, '59s'],
    [65000, '1m 05s'],
    [600000, '10m 00s'],
    [3723000, '1h 02m 03s'],
    [3600000, '1h 00m 00s']
  ])('formats %d ms as %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected)
  })
})
