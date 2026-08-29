import { useSyncExternalStore } from "react"

export type PendingComposerTurnFile = {
  type: "file"
  mime: string
  url: string
  filename: string
}

export type PendingComposerTurn = {
  key: string
  text: string
  files: PendingComposerTurnFile[]
  createdAt: number
}

export const pendingComposerDraftKey = (draftId: number): string => `draft:${draftId}`
export const pendingComposerSessionKey = (sessionId: string): string => `session:${sessionId}`

const PENDING_TTL_MS = 15_000
const listeners = new Set<() => void>()

let current: PendingComposerTurn | null = null
let timeoutId: ReturnType<typeof setTimeout> | null = null

const notify = (): void => {
  for (const listener of listeners) listener()
}

const clearTimer = (): void => {
  if (timeoutId == null) return
  clearTimeout(timeoutId)
  timeoutId = null
}

const armTimer = (key: string): void => {
  clearTimer()
  timeoutId = setTimeout(() => {
    if (current?.key === key) {
      current = null
      notify()
    }
    timeoutId = null
  }, PENDING_TTL_MS)
}

export const getPendingComposerTurn = (): PendingComposerTurn | null => current

export const subscribePendingComposerTurn = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const beginPendingComposerTurn = (input: {
  key: string
  text: string
  files?: PendingComposerTurnFile[]
}): PendingComposerTurn => {
  const next: PendingComposerTurn = {
    key: input.key,
    text: input.text,
    files: input.files ?? [],
    createdAt: Date.now(),
  }
  current = next
  armTimer(next.key)
  notify()
  return next
}

export const retargetPendingComposerTurn = (fromKey: string, toKey: string): void => {
  if (!current || current.key !== fromKey || !toKey || fromKey === toKey) return
  current = { ...current, key: toKey }
  armTimer(toKey)
  notify()
}

export const clearPendingComposerTurn = (key?: string): void => {
  if (!current) return
  if (key != null && current.key !== key) return
  current = null
  clearTimer()
  notify()
}

export const usePendingComposerTurn = (): PendingComposerTurn | null => (
  useSyncExternalStore(subscribePendingComposerTurn, getPendingComposerTurn, getPendingComposerTurn)
)
