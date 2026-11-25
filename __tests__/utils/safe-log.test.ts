import { beforeEach, describe, expect, it, jest } from '@jest/globals'

const core = { info: jest.fn(), warning: jest.fn() }
jest.unstable_mockModule('@actions/core', () => core)

const { neutraliseWorkflowCommands, safeInfo, safeWarning, escapeHtml } =
  await import('../../src/utils/safe-log.js')

const ZWSP = '​'

describe('neutraliseWorkflowCommands', () => {
  it('breaks a leading :: so it is not a workflow command', () => {
    expect(neutraliseWorkflowCommands('::error::boom')).toBe(
      `:${ZWSP}:error::boom`
    )
  })

  it('handles indentation, multiple lines and all newline styles', () => {
    expect(
      neutraliseWorkflowCommands('ok\r\n  ::warning::x\r::set-output\n::a')
    ).toBe(`ok\n  :${ZWSP}:warning::x\n:${ZWSP}:set-output\n:${ZWSP}:a`)
  })

  it('leaves ordinary text and mid-line colons alone', () => {
    expect(neutraliseWorkflowCommands('a :: b\n:single')).toBe(
      'a :: b\n:single'
    )
  })
})

describe('safeInfo / safeWarning', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('safeInfo neutralises before logging', () => {
    safeInfo('::notice::hi')
    expect(core.info).toHaveBeenCalledWith(`:${ZWSP}:notice::hi`)
  })

  it('safeWarning neutralises before warning', () => {
    safeWarning('::stop-commands::tok')
    expect(core.warning).toHaveBeenCalledWith(`:${ZWSP}:stop-commands::tok`)
  })
})

describe('escapeHtml', () => {
  it('escapes & < > " and apostrophes', () => {
    expect(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;'
    )
  })

  it('does not double-escape in a single pass and keeps plain text', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;')
    expect(escapeHtml('plain')).toBe('plain')
  })
})
