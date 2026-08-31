/**
 * Sidebar live chrome must share a clock with Stop / StatusRow.
 * Child session_status is the open-chat owner; the global index covers
 * rows whose directory store is not bootstrapped. Either busy/retry is live.
 * Absence of both is idle — never treat a missing global entry as truth when
 * the child is still running.
 */
export type SessionRowLiveStatusType = 'busy' | 'retry' | 'idle'

export function resolveSessionRowLiveStatus(input: {
  childStatus?: { type?: string } | null
  globalStatus?: { type?: string } | null
}): SessionRowLiveStatusType {
  const child = input.childStatus?.type
  if (child === 'busy' || child === 'retry') return child
  const global = input.globalStatus?.type
  if (global === 'busy' || global === 'retry') return global
  return 'idle'
}
