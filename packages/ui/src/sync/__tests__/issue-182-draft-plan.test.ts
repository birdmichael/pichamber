import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const createSessionCalls: Array<string | null | undefined> = []
const planStarts: Array<{ sessionID: string; action: string }> = []
const sendMessageCalls: Array<{ id?: string }> = []

mock.module('../pi-session-plan-store', () => ({
  dispatchSessionPlanAction: mock(async (sessionID: string, action: string) => {
    planStarts.push({ sessionID, action })
    return { status: 'active', planMarkdown: '' }
  }),
  applySessionPlan: () => undefined,
  refreshSessionPlan: async () => null,
  applySessionPlanEvent: () => null,
  resetPiSessionPlanStore: () => undefined,
  usePiSessionPlanStore: {
    getState: () => ({ plansBySession: {} }),
    setState: () => undefined,
  },
  useSessionPlan: () => null,
}))

const { opencodeClient } = await import('@/lib/opencode/client')
const { useConfigStore } = await import('@/stores/useConfigStore')
const { setActionRefs, setOptimisticRefs } = await import('../session-actions')
const { useSessionUIStore } = await import('../session-ui-store')
type OpencodeClient = Parameters<typeof setActionRefs>[0]

describe('issue 182 draft Plan send', () => {
  let originalSendMessage: typeof opencodeClient.sendMessage
  let originalCreateSession: typeof opencodeClient.createSession

  beforeEach(() => {
    createSessionCalls.length = 0
    planStarts.length = 0
    sendMessageCalls.length = 0

    const childStore = {
      getState: () => ({ session: [], message: {}, part: {}, session_status: {} }),
      setState: () => {},
    }
    setActionRefs(opencodeClient as unknown as OpencodeClient, {
      children: new Map(),
      ensureChild: () => childStore,
      getChild: () => childStore,
    } as never, () => '/projects/alpha')
    setOptimisticRefs(() => {}, () => {})
    useConfigStore.setState({ isConnected: true })

    originalSendMessage = opencodeClient.sendMessage
    originalCreateSession = opencodeClient.createSession
    opencodeClient.sendMessage = (async (params: { id?: string }) => {
      sendMessageCalls.push(params)
      return 'msg'
    }) as typeof opencodeClient.sendMessage
    opencodeClient.createSession = (async (_params: unknown, directory?: string | null) => {
      createSessionCalls.push(directory)
      return { id: 'ses_issue_182', directory: directory ?? '/projects/alpha' }
    }) as typeof opencodeClient.createSession
  })

  afterEach(() => {
    opencodeClient.sendMessage = originalSendMessage
    opencodeClient.createSession = originalCreateSession
    useSessionUIStore.setState({
      currentSessionId: null,
      currentSessionDirectory: null,
      newSessionDraft: { open: false, directoryOverride: null, parentID: null },
    })
  })

  test('draft Plan select stores local intent and does not create a session', () => {
    useSessionUIStore.setState({
      currentSessionId: null,
      currentSessionDirectory: null,
      newSessionDraft: {
        open: true,
        directoryOverride: '/projects/alpha',
        parentID: null,
      },
    })
    useSessionUIStore.getState().setDraftPlanSelected(true)

    expect(useSessionUIStore.getState().newSessionDraft.open).toBe(true)
    expect(useSessionUIStore.getState().newSessionDraft.planSelected).toBe(true)
    expect(useSessionUIStore.getState().currentSessionId).toBeNull()
    expect(createSessionCalls).toHaveLength(0)
  })

  test('send from a Plan-selected draft materializes once then starts plan', async () => {
    const draftSnapshot = {
      open: true,
      directoryOverride: '/projects/alpha',
      parentID: null,
      planSelected: true,
    }
    useSessionUIStore.setState({
      currentSessionId: null,
      currentSessionDirectory: null,
      newSessionDraft: draftSnapshot,
    })

    await useSessionUIStore.getState().sendMessage(
      'plan this feature',
      'provider-a',
      'model-a',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'normal',
      { draftSnapshot },
    )

    expect(createSessionCalls).toHaveLength(1)
    expect(planStarts).toEqual([{ sessionID: 'ses_issue_182', action: 'start' }])
    expect(sendMessageCalls).toHaveLength(1)
    expect(sendMessageCalls[0]?.id).toBe('ses_issue_182')
  })

  test('Agent draft send materializes once and does not start plan', async () => {
    const draftSnapshot = {
      open: true,
      directoryOverride: '/projects/alpha',
      parentID: null,
      planSelected: false,
    }
    useSessionUIStore.setState({
      currentSessionId: null,
      currentSessionDirectory: null,
      newSessionDraft: draftSnapshot,
    })

    await useSessionUIStore.getState().sendMessage(
      'just chat',
      'provider-a',
      'model-a',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'normal',
      { draftSnapshot },
    )

    expect(createSessionCalls).toHaveLength(1)
    expect(planStarts).toEqual([])
    expect(sendMessageCalls).toHaveLength(1)
  })
})
