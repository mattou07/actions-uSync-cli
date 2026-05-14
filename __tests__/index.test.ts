/**
 * Unit tests for the action's entrypoints
 */

import * as setupMain from '../src/setup/main'
import * as invokeMain from '../src/invoke/main'

// Mock the action's entrypoints
const setupRunMock = jest.spyOn(setupMain, 'run').mockImplementation()
const invokeRunMock = jest.spyOn(invokeMain, 'run').mockImplementation()

describe('action entrypoints', () => {
  it('setup calls run when imported', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../src/setup/index')

    expect(setupRunMock).toHaveBeenCalled()
  })

  it('invoke calls run when imported', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../src/invoke/index')

    expect(invokeRunMock).toHaveBeenCalled()
  })
})
