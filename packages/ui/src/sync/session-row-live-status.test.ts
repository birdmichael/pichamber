import { describe, expect, test } from 'bun:test'

import { resolveSessionRowLiveStatus } from './session-row-live-status'

describe('resolveSessionRowLiveStatus', () => {
  test('keeps the sidebar running from child status when the global index is missing', () => {
    expect(resolveSessionRowLiveStatus({
      childStatus: { type: 'busy' },
      globalStatus: undefined,
    })).toBe('busy')
    expect(resolveSessionRowLiveStatus({
      childStatus: { type: 'retry' },
      globalStatus: { type: 'idle' },
    })).toBe('retry')
  })

  test('keeps the sidebar running from the global index when the child store is not bootstrapped', () => {
    expect(resolveSessionRowLiveStatus({
      childStatus: undefined,
      globalStatus: { type: 'busy' },
    })).toBe('busy')
  })

  test('message_end completed time does not idle the row while either clock is busy', () => {
    expect(resolveSessionRowLiveStatus({
      childStatus: { type: 'busy' },
      globalStatus: { type: 'idle' },
    })).toBe('busy')
  })

  test('idles only when both clocks are idle or absent', () => {
    expect(resolveSessionRowLiveStatus({
      childStatus: { type: 'idle' },
      globalStatus: undefined,
    })).toBe('idle')
    expect(resolveSessionRowLiveStatus({})).toBe('idle')
  })
})
