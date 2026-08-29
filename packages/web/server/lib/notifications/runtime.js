export const createNotificationTriggerRuntime = (deps) => {
  const {
    readSettingsFromDisk,
    prepareNotificationLastMessage,
    buildTemplateVariables,
    extractLastMessageText,
    fetchLastAssistantMessageText,
    resolveNotificationTemplate,
    shouldApplyResolvedTemplateMessage,
    emitDesktopNotification,
    broadcastUiNotification,
    sendPushToAllUiSessions,
    sendApnsToAllUiSessions,
    isAnyInteractiveClientVisible,
    buildOpenCodeUrl,
    getOpenCodeAuthHeaders,
  } = deps;
  let getIsSessionAutoAccepting = deps.getIsSessionAutoAccepting;
  const setGetIsSessionAutoAccepting = (resolver) => {
    getIsSessionAutoAccepting = typeof resolver === 'function' ? resolver : undefined;
  };

  // App-icon badge for native push: the set of DISTINCT collapse-ids (the push
  // `tag`, e.g. `ready-<sessionId>` / `permission-<requestKey>`) we've sent since
  // the app was last foregrounded. The badge is the absolute APNs `aps.badge`.
  //
  // We key by `tag`, not sessionId, because the tag IS the banner identity: iOS
  // uses it as `apns-collapse-id`, so same-tag pushes REPLACE one banner while
  // different tags are distinct banners. One session can raise several banners
  // (ready + question + permission are different tags), so counting sessionIds
  // both over- and under-counts the lock-screen stack; counting tags mirrors it.
  //
  // We deliberately do NOT derive this from the live attention snapshot
  // (needsAttention/isViewed): that machinery is for in-app indicators on
  // connected clients — a backgrounded client stays "viewing", and needsAttention
  // is set by a separate session.status event that races the push trigger. The
  // set is cleared when a UI client reports visible (`clearPendingPushBadge`),
  // the same moment the device zeroes its icon badge on becomeActive.
  const pendingPushTags = new Set();
  const clearPendingPushBadge = () => {
    pendingPushTags.clear();
  };
  const trackPushAndCountBadge = (tag) => {
    if (typeof tag === 'string' && tag.length > 0) {
      pendingPushTags.add(tag);
    }
    return pendingPushTags.size;
  };

  // Generic notification for native push (per the mobile design): a fixed, scenario-based
  // title + the session name as the body. No model/project/message content crosses the relay.
  const APNS_TITLE_BY_TYPE = {
    ready: 'Agent response is ready',
    error: 'Agent hit an error',
    question: 'Agent needs your input',
    permission: 'Agent needs permission',
    goal_complete: 'Goal complete',
    goal_blocked: 'Goal blocked',
    goal_budget: 'Goal reached its token budget',
  };

  const PI_UI_PROMPT_KINDS = new Set(['select', 'confirm', 'input', 'editor']);
  const BLOCKING_PUSH_TYPES = new Set(['question', 'permission']);

  const opaqueApnsData = (data) => {
    const opaque = {};
    if (typeof data.sessionId === 'string' && data.sessionId.length > 0) {
      opaque.sessionId = data.sessionId;
    }
    if (typeof data.url === 'string' && data.url.length > 0) {
      opaque.url = data.url;
    }
    if (typeof data.deeplink === 'string' && data.deeplink.length > 0) {
      opaque.deeplink = data.deeplink;
    }
    if (typeof data.promptId === 'string' && data.promptId.length > 0) {
      opaque.promptId = data.promptId;
    }
    if (PI_UI_PROMPT_KINDS.has(data.kind)) {
      opaque.kind = data.kind;
    }
    return Object.keys(opaque).length > 0 ? opaque : undefined;
  };

  const toApnsGenericPayload = (payload) => {
    const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
    const sessionName = typeof data.sessionName === 'string' && data.sessionName.trim().length > 0
      ? data.sessionName.trim()
      : 'Session';
    return {
      title: APNS_TITLE_BY_TYPE[data.type] || 'Agent update',
      body: sessionName,
      badge: trackPushAndCountBadge(typeof payload?.tag === 'string' ? payload.tag : undefined),
      tag: payload?.tag,
      // Opaque ids only — never prompt titles, options, or transcript text.
      data: opaqueApnsData(data),
      ...(data.kind === 'confirm' ? { category: 'pi.ui.confirm' } : {}),
    };
  };

  // Fan a notification out to every delivery channel: browser web-push (full templated
  // payload) and native iOS APNs (generic model-based text). Both share the dedup tag.
  // Ready/error/goal skip APNs while an interactive desktop/web client is visible.
  // Blocking question/permission pushes always reach the phone so a focused Mac window
  // cannot swallow a waiting prompt. Skipping APNs also skips toApnsGenericPayload so
  // the badge is not incremented for an undelivered push.
  const fanoutPush = (payload, options = {}) => {
    const type = payload?.data && typeof payload.data === 'object' ? payload.data.type : undefined;
    const bypassInteractiveGate = options.bypassInteractiveGate === true || BLOCKING_PUSH_TYPES.has(type);
    const interactiveVisible = !bypassInteractiveGate && isAnyInteractiveClientVisible?.() === true;
    const pushOptions = { ...options, bypassInteractiveGate };
    console.info('[Push] fanout start', {
      type: type || payload?.data?.type || 'unknown',
      tag: typeof payload?.tag === 'string' ? payload.tag : undefined,
      bypassInteractiveGate,
      interactiveVisible,
    });
    return Promise.all([
      Promise.resolve(sendPushToAllUiSessions?.(payload, pushOptions)).catch((error) => {
        console.warn('[Push] web-push fanout failed:', error?.message ?? error);
      }),
      interactiveVisible
        ? Promise.resolve()
        : Promise.resolve(sendApnsToAllUiSessions?.(toApnsGenericPayload(payload), pushOptions)).catch((error) => {
            console.warn('[APNs] fanout failed:', error?.message ?? error);
          }),
    ]);
  };

  let getIsWindowFocused = typeof deps.getIsWindowFocused === 'function'
    ? deps.getIsWindowFocused
    : null;

  const setGetIsWindowFocused = (cb) => {
    getIsWindowFocused = typeof cb === 'function' ? cb : null;
  };

  const PUSH_READY_COOLDOWN_MS = 5000;
  const PUSH_QUESTION_DEBOUNCE_MS = 500;
  const PUSH_PERMISSION_DEBOUNCE_MS = 500;
  const pushQuestionDebounceTimers = new Map();
  const pushPermissionDebounceTimers = new Map();
  const notifiedPermissionRequests = new Set();
  const lastReadyNotificationAt = new Map();
  const lastErrorNotificationAt = new Map();
  // Latest completed assistant hop per session. Pi emits message_end (mapped to
  // message.updated finish:stop) for every LLM call, including thinking/tool
  // hops. Ready copy still wants that hop's model/agent, but the trigger must
  // wait for session.idle / agent_settled.
  const lastAssistantStopInfoBySession = new Map();

  const sessionParentIdCache = new Map();
  const SESSION_PARENT_CACHE_TTL_MS = 60 * 1000;

  // Sessions where the client has enabled Permission Auto-Accept. Mirrored
  // from the client-side permissionStore via POST /api/notifications/auto-accept
  // so the server can suppress permission notifications BEFORE dispatch (the
  // 500ms debounce race otherwise leaks notifications for auto-accepted
  // permissions when the replied round-trip is slower than the debounce).
  const autoAcceptingSessions = new Set();
  const setAutoAcceptSession = (sessionId, enabled) => {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return;
    if (enabled) {
      autoAcceptingSessions.add(sessionId);
    } else {
      autoAcceptingSessions.delete(sessionId);
    }
  };

  const buildSessionDeepLinkUrl = (sessionId) => {
    if (!sessionId || typeof sessionId !== 'string') {
      return '/';
    }
    return `/?session=${encodeURIComponent(sessionId)}`;
  };

  const buildPiUiDeepLinkUrl = (sessionId, promptId, kind) => {
    if (!sessionId || typeof sessionId !== 'string') {
      return '/';
    }
    const params = new URLSearchParams();
    if (typeof promptId === 'string' && promptId.length > 0) {
      params.set('prompt', promptId);
    }
    if (PI_UI_PROMPT_KINDS.has(kind)) {
      params.set('kind', kind);
    }
    const query = params.toString();
    return `pichamber://session/${encodeURIComponent(sessionId)}${query ? `?${query}` : ''}`;
  };

  const shouldEmitDesktopNotification = (settings) => (
    settings.nativeNotificationsEnabled
    && (settings.notificationMode === 'always' || !getIsWindowFocused?.())
  );

  const getSessionParentCacheKey = (sessionId, directory) => `${directory || ''}\0${sessionId}`;

  const getCachedSessionParentId = (sessionId, directory) => {
    const cacheKey = getSessionParentCacheKey(sessionId, directory);
    const entry = sessionParentIdCache.get(cacheKey);
    if (!entry) return undefined;
    if (Date.now() - entry.at > SESSION_PARENT_CACHE_TTL_MS) {
      sessionParentIdCache.delete(cacheKey);
      return undefined;
    }
    return entry.parentID;
  };

  const setCachedSessionParentId = (sessionId, directory, parentID) => {
    sessionParentIdCache.set(getSessionParentCacheKey(sessionId, directory), { parentID: parentID ?? null, at: Date.now() });
  };

  const getParentIdFromPayload = (payload) => {
    if (!payload || typeof payload !== 'object') return undefined;
    if (payload.type !== 'session.created' && payload.type !== 'session.updated') return undefined;
    const parentID = payload.properties?.info?.parentID ?? null;
    return typeof parentID === 'string' && parentID.length > 0 ? parentID : null;
  };

  const maybeCacheSessionParentFromPayload = (payload) => {
    const sessionId = extractSessionIdFromPayload(payload);
    if (typeof sessionId !== 'string' || sessionId.length === 0) return;
    const directory = extractDirectoryFromPayload(payload);
    const parentID = getParentIdFromPayload(payload);
    if (parentID === undefined) return;
    setCachedSessionParentId(sessionId, directory, parentID);
  };

  const fetchSessionParentId = async (sessionId, directory) => {
    if (!sessionId) return undefined;

    const cached = getCachedSessionParentId(sessionId, directory);
    if (cached !== undefined) return cached;

    try {
      const base = buildOpenCodeUrl(`/session/${encodeURIComponent(sessionId)}`, '');
      const url = directory ? `${base}?directory=${encodeURIComponent(directory)}` : base;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...getOpenCodeAuthHeaders(),
        },
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) {
        return undefined;
      }
      const session = await response.json().catch(() => null);
      if (!session || typeof session !== 'object') {
        return undefined;
      }

      const parentID = typeof session.parentID === 'string' && session.parentID.length > 0
        ? session.parentID
        : null;
      setCachedSessionParentId(sessionId, directory, parentID);
      return parentID;
    } catch {
      return undefined;
    }
  };

  // Mirrors client-side autoRespondsPermission: a session auto-accepts if it
  // OR any ancestor is flagged. Walks the parent chain via fetchSessionParentId.
  const isSessionAutoAccepting = async (sessionId, directory) => {
    if (!sessionId || autoAcceptingSessions.size === 0) return false;
    let current = sessionId;
    const seen = new Set();
    while (current && !seen.has(current)) {
      if (autoAcceptingSessions.has(current)) return true;
      seen.add(current);
      const parent = await fetchSessionParentId(current, directory);
      if (!parent) return false;
      current = parent;
    }
    return false;
  };

  const extractSessionIdFromPayload = (payload) => {
    if (!payload || typeof payload !== 'object') return null;
    const props = payload.properties;
    const info = props?.info;
    const sessionId =
      info?.sessionID ??
      info?.sessionId ??
      props?.sessionID ??
      props?.sessionId ??
      props?.session ??
      null;
    return typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : null;
  };

  const extractDirectoryFromPayload = (payload) => {
    if (!payload || typeof payload !== 'object') return undefined;
    const props = payload.properties;
    const directory = props?.directory ?? props?.info?.directory;
    if (typeof directory !== 'string') return undefined;
    const trimmed = directory.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };

  const formatMode = (raw) => {
    const value = typeof raw === 'string' ? raw.trim() : '';
    const normalized = value.length > 0 ? value : 'agent';
    return normalized
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
      .join(' ');
  };

  const formatModelId = (raw) => {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) {
      return 'Assistant';
    }

    const tokens = value.split(/[-_]+/).filter(Boolean);
    const result = [];
    for (let i = 0; i < tokens.length; i += 1) {
      const current = tokens[i];
      const next = tokens[i + 1];
      if (/^\d+$/.test(current) && next && /^\d+$/.test(next)) {
        result.push(`${current}.${next}`);
        i += 1;
        continue;
      }
      result.push(current);
    }

    return result
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  };

  // A session with an ACTIVE goal suppresses per-turn ready notifications;
  // the session-goal runtime sends its own notification when the goal
  // settles. Fetch failures fall through to normal notification behavior.
  const hasActiveSessionGoal = async (sessionId, directory) => {
    if (!sessionId) return false;
    try {
      const base = buildOpenCodeUrl(`/session/${encodeURIComponent(sessionId)}`, '');
      const url = directory ? `${base}?directory=${encodeURIComponent(directory)}` : base;
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json', ...getOpenCodeAuthHeaders() },
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) return false;
      const session = await response.json().catch(() => null);
      const goal = session?.metadata?.openchamber?.goal;
      return Boolean(goal && typeof goal === 'object' && goal.status === 'active');
    } catch {
      return false;
    }
  };

  const unwrapEventPayload = (payload) => {
    if (!payload || typeof payload !== 'object') return payload;
    if (typeof payload.type === 'string') return payload;
    const nested = payload.payload;
    if (nested && typeof nested === 'object' && typeof nested.type === 'string') {
      return nested;
    }
    return payload;
  };

  const maybeSendPushForTrigger = async (payload) => {
    payload = unwrapEventPayload(payload);
    if (!payload || typeof payload !== 'object') {
      return;
    }

    maybeCacheSessionParentFromPayload(payload);

    const sessionId = extractSessionIdFromPayload(payload);
    const notificationDirectory = extractDirectoryFromPayload(payload);
    if ((payload.type === 'session.idle' || payload.type === 'session.error') && sessionId) {
      const error = payload.properties?.error;
      const errorText = typeof error?.message === 'string'
        ? error.message
        : typeof error === 'string' ? error : '';
      const cachedInfo = lastAssistantStopInfoBySession.get(sessionId);
      await maybeSendPushForTrigger({
        ...payload,
        type: 'message.updated',
        // Intermediate assistant hops also arrive as message.updated finish:stop.
        // Only session.idle / session.error mean the user turn settled.
        sessionSettled: true,
        properties: {
          ...payload.properties,
          info: {
            ...(payload.type === 'session.idle' && cachedInfo && typeof cachedInfo === 'object'
              ? cachedInfo
              : {}),
            sessionID: sessionId,
            role: 'assistant',
            finish: payload.type === 'session.error' ? 'error' : 'stop',
            ...(errorText ? { parts: [{ type: 'text', text: errorText }] } : {}),
          },
        },
      });
      return;
    }

    if (payload.type === 'message.updated') {
      const info = payload.properties?.info;
      if (info?.role === 'assistant' && info?.finish === 'stop' && sessionId) {
        lastAssistantStopInfoBySession.set(sessionId, info);
        // Pi maps every assistant message_end to finish:stop, including the
        // first thinking/tool hop. Ready notifications wait for session.idle.
        if (payload.sessionSettled !== true) {
          return;
        }
        const settings = await readSettingsFromDisk();

        if (settings.notifyOnSubtasks === false) {
          const parentIDFromPayload = getParentIdFromPayload(payload);
          const parentID = parentIDFromPayload
            ? parentIDFromPayload
            : await fetchSessionParentId(sessionId, notificationDirectory);

          if (parentID !== null) {
            return;
          }
        }

        if (settings.notifyOnCompletion === false) {
          return;
        }

        // While a goal drives the session, per-turn "ready" notifications are
        // noise produced by the goal loop itself — the goal's own settle
        // notification (complete/blocked/budget) is the final word instead.
        if (await hasActiveSessionGoal(sessionId, notificationDirectory)) {
          return;
        }

        if (settings.notificationMode !== 'always' && getIsWindowFocused?.()) {
          return;
        }

        const now = Date.now();
        const lastAt = lastReadyNotificationAt.get(sessionId) ?? 0;
        if (now - lastAt < PUSH_READY_COOLDOWN_MS) {
          return;
        }
        lastReadyNotificationAt.set(sessionId, now);

        let title = `${formatMode(info?.mode)} agent is ready`;
        let body = `${formatModelId(info?.modelID)} completed the task`;
        let sessionName = '';

        try {
          const templates = settings.notificationTemplates || {};
          const isSubtask = await fetchSessionParentId(sessionId, notificationDirectory);
          const completionTemplate = isSubtask && settings.notifyOnSubtasks !== false
            ? (templates.subtask || templates.completion || { title: '{agent_name} is ready', message: '{model_name} completed the task' })
            : (templates.completion || { title: '{agent_name} is ready', message: '{model_name} completed the task' });

          const variables = await buildTemplateVariables(payload, sessionId);
          sessionName = typeof variables.session_name === 'string' ? variables.session_name : sessionName;

          const messageId = info?.id;
          let lastMessage = extractLastMessageText(payload);
          if (!lastMessage) {
            lastMessage = await fetchLastAssistantMessageText(sessionId, messageId);
          }

          variables.last_message = await prepareNotificationLastMessage({
            message: lastMessage,
            settings,
          });

          const resolvedTitle = resolveNotificationTemplate(completionTemplate.title, variables);
          const resolvedBody = resolveNotificationTemplate(completionTemplate.message, variables);
          if (resolvedTitle) title = resolvedTitle;
          if (shouldApplyResolvedTemplateMessage(completionTemplate.message, resolvedBody, variables)) body = resolvedBody;
        } catch (error) {
          console.warn('[Notification] Template resolution failed, using defaults:', error?.message || error);
        }

        if (settings.nativeNotificationsEnabled) {
          const notificationPayload = {
            title,
            body,
            tag: `ready-${sessionId}`,
            kind: 'ready',
            sessionId,
            directory: notificationDirectory,
            requireHidden: settings.notificationMode !== 'always',
          };
          const desktopNotificationDelivered = emitDesktopNotification(notificationPayload);
          broadcastUiNotification(notificationPayload, { desktopNotificationDelivered });
        }

        await fanoutPush(
          {
            title,
            body,
            tag: `ready-${sessionId}`,
            data: {
              url: buildSessionDeepLinkUrl(sessionId),
              sessionId,
              sessionName,
              type: 'ready',
            },
          },
          { requireNoSse: true },
        );
      }

      if (info?.role === 'assistant' && info?.finish === 'error' && sessionId) {
        const settings = await readSettingsFromDisk();
        if (settings.notifyOnError === false) return;

        const now = Date.now();
        const lastAt = lastErrorNotificationAt.get(sessionId) ?? 0;
        if (now - lastAt < PUSH_READY_COOLDOWN_MS) return;
        lastErrorNotificationAt.set(sessionId, now);

        if (settings.notificationMode !== 'always' && getIsWindowFocused?.()) {
          return;
        }

        let title = 'Tool error';
        let body = 'An error occurred';
        let sessionName = '';

        try {
          const variables = await buildTemplateVariables(payload, sessionId);
          sessionName = typeof variables.session_name === 'string' ? variables.session_name : sessionName;
          const errorMessageId = info?.id;
          let lastMessage = extractLastMessageText(payload);
          if (!lastMessage) {
            lastMessage = await fetchLastAssistantMessageText(sessionId, errorMessageId);
          }

          variables.last_message = await prepareNotificationLastMessage({
            message: lastMessage,
            settings,
          });

          const errorTemplate = (settings.notificationTemplates || {}).error || { title: 'Tool error', message: '{last_message}' };
          const resolvedTitle = resolveNotificationTemplate(errorTemplate.title, variables);
          const resolvedBody = resolveNotificationTemplate(errorTemplate.message, variables);
          if (resolvedTitle) title = resolvedTitle;
          if (shouldApplyResolvedTemplateMessage(errorTemplate.message, resolvedBody, variables)) body = resolvedBody;
        } catch (error) {
          console.warn('[Notification] Error template resolution failed, using defaults:', error?.message || error);
        }

        if (settings.nativeNotificationsEnabled) {
          const notificationPayload = {
            title,
            body,
            tag: `error-${sessionId}`,
            kind: 'error',
            sessionId,
            directory: notificationDirectory,
            requireHidden: settings.notificationMode !== 'always',
          };
          const desktopNotificationDelivered = emitDesktopNotification(notificationPayload);
          broadcastUiNotification(notificationPayload, { desktopNotificationDelivered });
        }

        await fanoutPush(
          {
            title,
            body,
            tag: `error-${sessionId}`,
            data: {
              url: buildSessionDeepLinkUrl(sessionId),
              sessionId,
              sessionName,
              type: 'error',
            },
          },
          { requireNoSse: true },
        );
      }

      return;
    }

    if (payload.type === 'question.asked' && sessionId) {
      const existingTimer = pushQuestionDebounceTimers.get(sessionId);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      const timer = setTimeout(async () => {
        pushQuestionDebounceTimers.delete(sessionId);

        const settings = await readSettingsFromDisk();
        if (settings.notifyOnQuestion === false) {
          console.info('[Push] skipped: notifyOnQuestion=false', { type: 'question.asked', sessionId });
          return;
        }

        const firstQuestion = payload.properties?.questions?.[0];
        const header = typeof firstQuestion?.header === 'string' ? firstQuestion.header.trim() : '';
        const questionText = typeof firstQuestion?.question === 'string' ? firstQuestion.question.trim() : '';

        // Default Desktop banner stays content-free. Custom templates may still
        // use {last_message}; shipped defaults use {session_name}.
        let title = /plan\s*mode/i.test(header)
          ? 'Switch to plan mode'
          : /build\s*agent/i.test(header)
            ? 'Switch to build mode'
            : 'Input needed';
        let body = 'Agent is waiting for your response';
        let sessionName = '';

        try {
          const variables = await buildTemplateVariables(payload, sessionId);
          sessionName = typeof variables.session_name === 'string' ? variables.session_name : sessionName;
          variables.last_message = questionText || header || '';

          const templates = settings.notificationTemplates || {};
          const questionTemplate = templates.question || { title: 'Input needed', message: '{session_name}' };

          const resolvedTitle = resolveNotificationTemplate(questionTemplate.title, variables);
          const resolvedBody = resolveNotificationTemplate(questionTemplate.message, variables);
          if (resolvedTitle) title = resolvedTitle;
          if (shouldApplyResolvedTemplateMessage(questionTemplate.message, resolvedBody, variables)) body = resolvedBody;
        } catch (error) {
          console.warn('[Notification] Question template resolution failed, using defaults:', error?.message || error);
        }

        if (shouldEmitDesktopNotification(settings)) {
          const notificationPayload = {
            kind: 'question',
            title,
            body,
            tag: `question-${sessionId}`,
            sessionId,
            directory: notificationDirectory,
            requireHidden: settings.notificationMode !== 'always',
          };
          const desktopNotificationDelivered = emitDesktopNotification(notificationPayload);
          broadcastUiNotification(notificationPayload, { desktopNotificationDelivered });
        }

        void fanoutPush(
          {
            title,
            body,
            tag: `question-${sessionId}`,
            data: {
              url: buildSessionDeepLinkUrl(sessionId),
              sessionId,
              sessionName,
              type: 'question',
            },
          },
          { requireNoSse: true },
        );
      }, PUSH_QUESTION_DEBOUNCE_MS);

      pushQuestionDebounceTimers.set(sessionId, timer);
      return;
    }

    if (payload.type === 'pi.ui.asked' && sessionId) {
      const prompt = payload.properties?.prompt && typeof payload.properties.prompt === 'object'
        ? payload.properties.prompt
        : {};
      const promptId = typeof prompt.id === 'string' && prompt.id.length > 0 ? prompt.id : null;
      const kind = prompt.kind;
      if (!PI_UI_PROMPT_KINDS.has(kind)) {
        return;
      }

      // Key by prompt, not session: concurrent ctx.ui prompts must not cancel each other.
      const debounceKey = promptId ? `pi-ui:${promptId}` : `pi-ui:${sessionId}`;
      const existingTimer = pushQuestionDebounceTimers.get(debounceKey);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      const timer = setTimeout(async () => {
        pushQuestionDebounceTimers.delete(debounceKey);

        const settings = await readSettingsFromDisk();
        if (settings.notifyOnQuestion === false) {
          console.info('[Push] skipped: notifyOnQuestion=false', { type: 'pi.ui.asked', sessionId, promptId });
          return;
        }

        const header = typeof prompt.title === 'string' ? prompt.title.trim() : '';
        const questionText = typeof prompt.message === 'string' ? prompt.message.trim() : '';
        // Default Desktop banner stays content-free. Custom templates may still
        // use {last_message}; shipped defaults use {session_name}.
        let title = 'Input needed';
        let body = 'Agent is waiting for your response';
        let sessionName = '';

        try {
          const variables = await buildTemplateVariables(payload, sessionId);
          sessionName = typeof variables.session_name === 'string' ? variables.session_name : sessionName;
          variables.last_message = questionText || header || '';
          const templates = settings.notificationTemplates || {};
          const questionTemplate = templates.question || { title: 'Input needed', message: '{session_name}' };
          const resolvedTitle = resolveNotificationTemplate(questionTemplate.title, variables);
          const resolvedBody = resolveNotificationTemplate(questionTemplate.message, variables);
          if (resolvedTitle) title = resolvedTitle;
          if (shouldApplyResolvedTemplateMessage(questionTemplate.message, resolvedBody, variables)) body = resolvedBody;
        } catch (error) {
          console.warn('[Notification] Pi UI question template resolution failed, using defaults:', error?.message || error);
        }

        const tag = promptId ? `question-${promptId}` : `question-${sessionId}`;
        if (shouldEmitDesktopNotification(settings)) {
          const notificationPayload = {
            kind: 'question',
            title,
            body,
            tag,
            sessionId,
            directory: notificationDirectory,
            requireHidden: settings.notificationMode !== 'always',
          };
          const desktopNotificationDelivered = emitDesktopNotification(notificationPayload);
          broadcastUiNotification(notificationPayload, { desktopNotificationDelivered });
        }

        void fanoutPush(
          {
            title,
            body,
            tag,
            data: {
              url: buildSessionDeepLinkUrl(sessionId),
              deeplink: buildPiUiDeepLinkUrl(sessionId, promptId, kind),
              sessionId,
              sessionName,
              type: 'question',
              ...(promptId ? { promptId } : {}),
              kind,
            },
          },
          { requireNoSse: true },
        );
      }, PUSH_QUESTION_DEBOUNCE_MS);

      pushQuestionDebounceTimers.set(debounceKey, timer);
      return;
    }

    if (payload.type === 'pi.ui.settled' && sessionId) {
      const settledPrompt = payload.properties?.prompt && typeof payload.properties.prompt === 'object'
        ? payload.properties.prompt
        : {};
      const settledPromptId = typeof settledPrompt.id === 'string' && settledPrompt.id.length > 0
        ? settledPrompt.id
        : null;
      const debounceKey = settledPromptId ? `pi-ui:${settledPromptId}` : `pi-ui:${sessionId}`;
      const existingTimer = pushQuestionDebounceTimers.get(debounceKey);
      if (existingTimer) {
        clearTimeout(existingTimer);
        pushQuestionDebounceTimers.delete(debounceKey);
      }
      return;
    }

    if (payload.type === 'permission.replied' && sessionId) {
      const requestId = payload.properties?.requestID ?? payload.properties?.requestId ?? payload.properties?.id;
      const requestKey = typeof requestId === 'string' ? `${sessionId}:${requestId}` : null;
      const pendingNotification = pushPermissionDebounceTimers.get(sessionId);
      if (!pendingNotification) {
        return;
      }

      // Some runtimes may omit requestID on permission.replied.
      // When request ID is missing, clear session debounce to avoid
      // showing stale permission notifications for auto-approved prompts.
      if (!requestKey || !pendingNotification.requestKey || pendingNotification.requestKey === requestKey) {
        clearTimeout(pendingNotification.timer);
        pushPermissionDebounceTimers.delete(sessionId);
      }
      return;
    }

    if (payload.type === 'permission.asked' && sessionId) {
      const requestId = payload.properties?.id ?? payload.properties?.requestID ?? payload.properties?.requestId;
      const permission = payload.properties?.permission;
      const requestKey = typeof requestId === 'string' ? `${sessionId}:${requestId}` : null;
      if (requestKey && notifiedPermissionRequests.has(requestKey)) {
        return;
      }

      // Client may be in Permission Auto-Accept for this session (or any
      // ancestor). Skip the whole notification path — the client responds
      // directly and the user has opted out of approval prompts.
      if (await (getIsSessionAutoAccepting?.(sessionId, notificationDirectory)
        ?? isSessionAutoAccepting(sessionId, notificationDirectory))) {
        if (requestKey) notifiedPermissionRequests.add(requestKey);
        return;
      }

      const existingTimer = pushPermissionDebounceTimers.get(sessionId);
      if (existingTimer) {
        clearTimeout(existingTimer.timer);
      }

      const timer = setTimeout(async () => {
        pushPermissionDebounceTimers.delete(sessionId);

        if (await (getIsSessionAutoAccepting?.(sessionId, notificationDirectory)
          ?? isSessionAutoAccepting(sessionId, notificationDirectory))) {
          if (requestKey) notifiedPermissionRequests.add(requestKey);
          return;
        }

        const settings = await readSettingsFromDisk();

        if (settings.notifyOnQuestion === false) {
          return;
        }

        const sessionTitle = payload.properties?.sessionTitle;
        const permissionText = typeof permission === 'string' && permission.length > 0 ? permission : '';
        const fallbackMessage = typeof sessionTitle === 'string' && sessionTitle.trim().length > 0
          ? sessionTitle.trim()
          : permissionText || 'Agent is waiting for your approval';

        let title = 'Permission required';
        let body = fallbackMessage;
        let sessionName = '';

        try {
          const variables = await buildTemplateVariables(payload, sessionId);
          sessionName = typeof variables.session_name === 'string' ? variables.session_name : sessionName;
          variables.last_message = fallbackMessage;

          const templates = settings.notificationTemplates || {};
          const questionTemplate = templates.question || { title: 'Permission required', message: '{last_message}' };

          const resolvedTitle = resolveNotificationTemplate(questionTemplate.title, variables);
          const resolvedBody = resolveNotificationTemplate(questionTemplate.message, variables);
          if (resolvedTitle) title = resolvedTitle;
          if (shouldApplyResolvedTemplateMessage(questionTemplate.message, resolvedBody, variables)) body = resolvedBody;
        } catch (error) {
          console.warn('[Notification] Permission template resolution failed, using defaults:', error?.message || error);
        }

        if (shouldEmitDesktopNotification(settings)) {
          const notificationPayload = {
            kind: 'permission',
            title,
            body,
            tag: requestKey ? `permission-${requestKey}` : `permission-${sessionId}`,
            sessionId,
            directory: notificationDirectory,
            requireHidden: settings.notificationMode !== 'always',
          };
          const desktopNotificationDelivered = emitDesktopNotification(notificationPayload);
          broadcastUiNotification(notificationPayload, { desktopNotificationDelivered });
        }

        if (requestKey) {
          notifiedPermissionRequests.add(requestKey);
        }

        void fanoutPush(
          {
            title,
            body,
            tag: `permission-${sessionId}`,
            data: {
              url: buildSessionDeepLinkUrl(sessionId),
              sessionId,
              sessionName,
              type: 'permission',
            },
          },
          { requireNoSse: true },
        );
      }, PUSH_PERMISSION_DEBOUNCE_MS);

      pushPermissionDebounceTimers.set(sessionId, { timer, requestKey });
    }
  };

  // Goal settle push: same fanout as the trigger paths (web-push with the
  // full text; APNs with the generic per-type title and the session name as
  // body, so the relay never sees content).
  const sendGoalSettlePush = async ({ sessionId, directory, status, title, body }) => {
    let sessionName = '';
    try {
      const base = buildOpenCodeUrl(`/session/${encodeURIComponent(sessionId)}`, '');
      const url = directory ? `${base}?directory=${encodeURIComponent(directory)}` : base;
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json', ...getOpenCodeAuthHeaders() },
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) {
        const session = await response.json().catch(() => null);
        if (typeof session?.title === 'string') sessionName = session.title.trim();
      }
    } catch {
      // Session name is presentation sugar for the mobile push — never block on it.
    }
    const type = status === 'complete' ? 'goal_complete' : (status === 'budgetLimited' ? 'goal_budget' : 'goal_blocked');
    await fanoutPush(
      {
        title,
        body,
        tag: `goal-${sessionId}`,
        data: {
          url: buildSessionDeepLinkUrl(sessionId),
          sessionId,
          sessionName,
          type,
        },
      },
      { requireNoSse: true },
    );
  };

  return {
    maybeSendPushForTrigger,
    setAutoAcceptSession,
    setGetIsWindowFocused,
    setGetIsSessionAutoAccepting,
    clearPendingPushBadge,
    sendGoalSettlePush,
  };
};
