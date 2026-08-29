import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const createSessionCalls: Array<string | null | undefined> = []
const planStarts: Array<{ sessionID: string; action: string }> = []
const planApplies: Array<{ sessionID: string; status: string }> = []
const sendMessageCalls: Array<{ id?: string }> = []

mock.module('../pi-session-plan-store', () => ({
  dispatchSessionPlanAction: mock(async (sessionID: string, action: string) => {
    planStarts.push({ sessionID, action })
    return { status: 'active', planMarkdown: '' }
  }),
  applySessionPlan: (sessionID: string, plan: { status?: string } | null) => {
    if (plan?.status) planApplies.push({ sessionID, status: plan.status })
  },
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
const { useDirectoryStore } = await import('@/stores/useDirectoryStore')
const { useProjectsStore } = await import('@/stores/useProjectsStore')
const { setActionRefs, setOptimisticRefs } = await import('../session-actions')
const { useSessionUIStore } = await import('../session-ui-store')
type OpencodeClient = Parameters<typeof setActionRefs>[0]

const projectAlpha = { id: 'proj-alpha', path: '/projects/alpha', label: 'Alpha' }

const resetDraftPlanState = () => {
  useSessionUIStore.setState({
    currentSessionId: null,
    currentSessionDirectory: null,
    emptyComposerPlanSelected: false,
    newSessionDraft: { draftId: 0, open: false, directoryOverride: null, parentID: null, target: 'chat' },
  })
}

const openAlphaDraft = () => {
  useProjectsStore.setState({
    projects: [projectAlpha],
    activeProjectId: projectAlpha.id,
  })
  useDirectoryStore.getState().setDirectory(projectAlpha.path, { showOverlay: false })
  useSessionUIStore.getState().openNewSessionDraft({
    selectedProjectId: projectAlpha.id,
    directoryOverride: projectAlpha.path,
  })
}

describe('issue 182 draft Plan send', () => {
  let originalSendMessage: typeof opencodeClient.sendMessage
  let originalCreateSession: typeof opencodeClient.createSession

  beforeEach(() => {
    createSessionCalls.length = 0
    planStarts.length = 0
    planApplies.length = 0
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
    resetDraftPlanState()
  })

  test('draft Plan select stores local intent and does not create a session', () => {
    useSessionUIStore.setState({
      currentSessionId: null,
      currentSessionDirectory: null,
      newSessionDraft: {
        draftId: 1,
        open: true,
        directoryOverride: '/projects/alpha',
        parentID: null,
        target: 'project',
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
      draftId: 1,
      open: true,
      directoryOverride: '/projects/alpha',
      parentID: null,
      planSelected: true,
      target: 'project' as const,
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
    expect(planApplies[0]).toEqual({ sessionID: 'ses_issue_182', status: 'active' })
    expect(planStarts).toEqual([{ sessionID: 'ses_issue_182', action: 'start' }])
    expect(sendMessageCalls).toHaveLength(1)
    expect(sendMessageCalls[0]?.id).toBe('ses_issue_182')
    const { resolveFooterPlanSelected } = await import('../pi-session-plan')
    expect(resolveFooterPlanSelected({
      available: true,
      status: 'off',
      sessionID: 'ses_issue_182',
      draftOpen: false,
      draftPlanSelected: true,
    })).toBe(true)
  })

  test('Agent draft send materializes once and does not start plan', async () => {
    const draftSnapshot = {
      draftId: 1,
      open: true,
      directoryOverride: '/projects/alpha',
      parentID: null,
      planSelected: false,
      target: 'project' as const,
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

  test('New session after visiting history starts Agent, not the previous draft Plan', () => {
    openAlphaDraft()
    useSessionUIStore.getState().setDraftPlanSelected(true)

    expect(useSessionUIStore.getState().emptyComposerPlanSelected).toBe(true)
    expect(createSessionCalls).toHaveLength(0)

    useSessionUIStore.getState().setCurrentSession('ses_history_agent', '/projects/alpha')

    expect(useSessionUIStore.getState().newSessionDraft.open).toBe(false)
    expect(useSessionUIStore.getState().currentSessionId).toBe('ses_history_agent')
    expect(useSessionUIStore.getState().emptyComposerPlanSelected).toBe(true)
    expect(createSessionCalls).toHaveLength(0)

    openAlphaDraft()

    expect(useSessionUIStore.getState().currentSessionId).toBeNull()
    expect(useSessionUIStore.getState().newSessionDraft.open).toBe(true)
    expect(useSessionUIStore.getState().newSessionDraft.planSelected).toBe(false)
    expect(useSessionUIStore.getState().emptyComposerPlanSelected).toBe(false)
    expect(createSessionCalls).toHaveLength(0)
  })

  test('explicit Agent pick on the empty composer stays Agent after a session switch', () => {
    openAlphaDraft()
    useSessionUIStore.getState().setDraftPlanSelected(true)
    useSessionUIStore.getState().setDraftPlanSelected(false)
    useSessionUIStore.getState().setCurrentSession('ses_history_agent', '/projects/alpha')
    openAlphaDraft()

    expect(useSessionUIStore.getState().newSessionDraft.planSelected).toBe(false)
    expect(useSessionUIStore.getState().emptyComposerPlanSelected).toBe(false)
    expect(createSessionCalls).toHaveLength(0)
  })

  test('sending a Plan draft consumes empty-composer Plan for the next New session', async () => {
    const draftSnapshot = {
      draftId: 1,
      open: true,
      directoryOverride: '/projects/alpha',
      parentID: null,
      planSelected: true,
      target: 'project' as const,
    }
    useSessionUIStore.setState({
      currentSessionId: null,
      currentSessionDirectory: null,
      emptyComposerPlanSelected: true,
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

    expect(useSessionUIStore.getState().emptyComposerPlanSelected).toBe(false)
    expect(createSessionCalls).toHaveLength(1)
    expect(planStarts).toEqual([{ sessionID: 'ses_issue_182', action: 'start' }])

    openAlphaDraft()
    expect(useSessionUIStore.getState().newSessionDraft.planSelected).toBe(false)
  })
})
