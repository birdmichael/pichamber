// Isolated from issue-182-draft-plan.test.ts: that file mocks the plan store
// and this one uses the real store. Shared runtime-fetch mocks also leak.
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const createSessionCalls: Array<string | null | undefined> = []
const sendMessageCalls: Array<{ id?: string }> = []
const planPosts: Array<{ action?: string }> = []
let failPlanStart = false

mock.module('@/lib/runtime-fetch', () => ({
  runtimeFetch: mock(async (path: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET'
    if (typeof path === 'string' && path.includes('/plan') && method === 'POST') {
      const body = init?.body ? JSON.parse(init.body) as { action?: string } : {}
      planPosts.push(body)
      if (failPlanStart) {
        return { ok: false, status: 500, json: async () => null }
      }
      return { ok: true, json: async () => ({ status: 'active', planMarkdown: '' }) }
    }
    if (typeof path === 'string' && path.includes('/plan')) {
      return { ok: true, json: async () => ({ status: 'off', planMarkdown: '' }) }
    }
    return { ok: true, json: async () => ({}) }
  }),
}))

const { opencodeClient } = await import('@/lib/opencode/client')
const { useConfigStore } = await import('@/stores/useConfigStore')
const { setActionRefs, setOptimisticRefs } = await import('../session-actions')
const { resolveFooterPlanSelected } = await import('../pi-session-plan')
const {
  isPendingDraftPlan,
  refreshSessionPlan,
  resetPiSessionPlanStore,
  usePiSessionPlanStore,
} = await import('../pi-session-plan-store')
const { useSessionUIStore } = await import('../session-ui-store')
type OpencodeClient = Parameters<typeof setActionRefs>[0]

const footerPlanSelected = () => {
  const ui = useSessionUIStore.getState()
  const sessionID = ui.currentSessionId
  const plan = sessionID ? usePiSessionPlanStore.getState().plansBySession[sessionID] : undefined
  return resolveFooterPlanSelected({
    available: true,
    status: plan?.status,
    sessionID,
    draftOpen: ui.newSessionDraft.open,
    draftPlanSelected: ui.newSessionDraft.planSelected === true,
    pendingDraftPlan: isPendingDraftPlan(sessionID),
  })
}

const resetState = () => {
  resetPiSessionPlanStore()
  useSessionUIStore.setState({
    currentSessionId: null,
    currentSessionDirectory: null,
    emptyComposerPlanSelected: false,
    newSessionDraft: { draftId: 0, open: false, directoryOverride: null, parentID: null, target: 'chat' },
  })
}

describe('issue 182 draft Plan send chrome', () => {
  let originalSendMessage: typeof opencodeClient.sendMessage
  let originalCreateSession: typeof opencodeClient.createSession

  beforeEach(() => {
    createSessionCalls.length = 0
    sendMessageCalls.length = 0
    planPosts.length = 0
    failPlanStart = false
    resetState()

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
    resetState()
  })

  test('createSession from a Plan draft keeps the footer on Plan after the draft is gone', async () => {
    useSessionUIStore.setState({
      currentSessionId: null,
      currentSessionDirectory: null,
      newSessionDraft: {
        draftId: 1,
        open: true,
        directoryOverride: '/projects/alpha',
        parentID: null,
        planSelected: true,
        target: 'project',
      },
    })

    const session = await useSessionUIStore.getState().createSession(
      'Draft title',
      '/projects/alpha',
    )

    expect(session?.id).toBe('ses_issue_182')
    expect(createSessionCalls).toHaveLength(1)
    expect(useSessionUIStore.getState().newSessionDraft.open).toBe(false)
    expect(useSessionUIStore.getState().newSessionDraft.planSelected).toBe(undefined)
    expect(useSessionUIStore.getState().currentSessionId).toBe('ses_issue_182')
    expect(usePiSessionPlanStore.getState().plansBySession.ses_issue_182?.status).toBe('active')
    expect(footerPlanSelected()).toBe(true)

    await refreshSessionPlan('ses_issue_182')
    expect(footerPlanSelected()).toBe(true)
  })

  test('draft Plan send keeps the footer on Plan after createSession and the first prompt', async () => {
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
      'say bye in one word',
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
    expect(sendMessageCalls).toHaveLength(1)
    expect(sendMessageCalls[0]?.id).toBe('ses_issue_182')
    expect(planPosts).toEqual([{ action: 'start' }])
    expect(useSessionUIStore.getState().newSessionDraft.open).toBe(false)
    expect(useSessionUIStore.getState().currentSessionId).toBe('ses_issue_182')
    expect(footerPlanSelected()).toBe(true)
  })

  test('a failed /plan start after draft close does not flip the footer to Agent', async () => {
    failPlanStart = true
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
      'say bye in one word',
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

    expect(planPosts).toEqual([{ action: 'start' }])
    expect(useSessionUIStore.getState().newSessionDraft.open).toBe(false)
    expect(useSessionUIStore.getState().currentSessionId).toBe('ses_issue_182')
    expect(footerPlanSelected()).toBe(true)
  })

  test('Agent draft send does not adopt Plan or start /plan', async () => {
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
    expect(planPosts).toEqual([])
    expect(footerPlanSelected()).toBe(false)
    expect(usePiSessionPlanStore.getState().plansBySession.ses_issue_182).toBe(undefined)
  })
})
