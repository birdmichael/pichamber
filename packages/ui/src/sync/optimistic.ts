import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import { sortMessagesChronologically } from "./message-ordering"

function filterIdentifiedParts(parts: Part[]): Part[] {
  return parts.filter((part) => !!part?.id)
}

export type OptimisticItem = {
  message: Message
  parts: Part[]
}

export type MessagePage = {
  session: Message[]
  part: { id: string; part: Part[] }[]
  cursor?: string
  complete: boolean
}

const containsAllPartsByID = (currentParts: Part[] | undefined, requiredParts: Part[]) => {
  if (!currentParts) return requiredParts.length === 0
  const currentPartIDs = new Set(currentParts.map((part) => part.id))
  return requiredParts.every((part) => currentPartIDs.has(part.id))
}

const mergeParts = (currentParts: Part[] | undefined, optimisticParts: Part[]) => {
  if (!currentParts) return filterIdentifiedParts(optimisticParts)
  const next = [...currentParts]
  const partIDs = new Set(currentParts.map((part) => part.id))
  let changed = false
  for (const part of optimisticParts) {
    if (partIDs.has(part.id)) continue
    partIDs.add(part.id)
    next.push(part)
    changed = true
  }
  if (!changed) return currentParts
  return next
}

const userTextFromParts = (parts: Part[] | undefined): string => {
  if (!Array.isArray(parts)) return ""
  return parts
    .filter((part) => part?.type === "text" && typeof (part as { text?: unknown }).text === "string")
    .map((part) => String((part as { text: string }).text).trim())
    .join("\n")
}

export function mergeOptimisticPage(page: MessagePage, items: OptimisticItem[]) {
  if (items.length === 0) return { ...page, confirmed: [] as string[] }

  const session = [...page.session]
  const messageIDs = new Set(session.map((message) => message.id))
  const partsByMessageID = new Map(page.part.map((item) => [item.id, filterIdentifiedParts(item.part)]))
  const confirmed: string[] = []
  const usedSameTextUsers = new Set<string>()

  for (const item of items) {
    const messageExists = messageIDs.has(item.message.id)
    if (!messageExists && item.message.role === "user") {
      const optimisticText = userTextFromParts(item.parts)
      const serverMatch = optimisticText
        ? session.find((message) => (
          message.role === "user"
          && !usedSameTextUsers.has(message.id)
          && userTextFromParts(partsByMessageID.get(message.id)) === optimisticText
        ))
        : undefined
      if (serverMatch) {
        usedSameTextUsers.add(serverMatch.id)
        confirmed.push(item.message.id)
        continue
      }
    }
    if (!messageExists) {
      messageIDs.add(item.message.id)
      session.push(item.message)
    }

    const currentParts = partsByMessageID.get(item.message.id)
    if (messageExists && containsAllPartsByID(currentParts, item.parts)) {
      confirmed.push(item.message.id)
      continue
    }

    partsByMessageID.set(item.message.id, mergeParts(currentParts, item.parts))
  }

  return {
    cursor: page.cursor,
    complete: page.complete,
    session: sortMessagesChronologically(session),
    part: [...partsByMessageID].map(([id, part]) => ({ id, part })),
    confirmed,
  }
}

/** Merge two chronologically sorted message arrays by identity, deduplicating.
 *  Preserves existing references for items that already exist — avoids
 *  unnecessary React re-renders when prepending older history. */
export function mergeMessages<T extends Message>(existingMessages: readonly T[], incomingMessages: readonly T[]) {
  const messagesByID = new Map(existingMessages.map((item) => [item.id, item] as const))
  let changed = false
  for (const item of incomingMessages) {
    if (!messagesByID.has(item.id)) {
      messagesByID.set(item.id, item)
      changed = true
    }
  }
  if (!changed) return existingMessages as T[]
  return sortMessagesChronologically([...messagesByID.values()])
}
