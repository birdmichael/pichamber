import { parseMessageModelRef, type MessageModelRef } from '@/lib/messages/userModelChoice'

type FooterModelSelection = {
  providerId: string
  modelId: string
} | null | undefined

const sameRef = (left: MessageModelRef, right: MessageModelRef): boolean => (
  left.providerId === right.providerId && left.modelId === right.modelId
)

const usableSelection = (selection: FooterModelSelection): MessageModelRef | null => {
  if (!selection) return null
  const providerId = selection.providerId.trim()
  const modelId = selection.modelId.trim()
  if (!providerId || !modelId) return null
  if (providerId === 'pi' && modelId === 'pi') return null
  return { providerId, modelId }
}

const isUserMessageInfo = (info: unknown): boolean => {
  if (!info || typeof info !== 'object') return false
  const record = info as Record<string, unknown>
  const clientRole = record.clientRole
  const role = typeof clientRole === 'string' ? clientRole : record.role
  return role === 'user'
}

/** Footer model for the turn that ran / was on the composer at send. */
export const resolveAssistantFooterModel = (input: {
  assistantInfo?: unknown
  userTurnInfo?: unknown
  sessionSelection?: FooterModelSelection
  agentSelection?: FooterModelSelection
}): MessageModelRef | null => {
  const userTurn = isUserMessageInfo(input.userTurnInfo)
    ? parseMessageModelRef(input.userTurnInfo)
    : null
  const assistant = parseMessageModelRef(input.assistantInfo)
  const session = usableSelection(input.sessionSelection)
  const agent = usableSelection(input.agentSelection)

  if (userTurn) {
    if (assistant && sameRef(assistant, userTurn)) return assistant
    return userTurn
  }
  if (assistant) return assistant
  if (session) return session
  return agent
}
