import os from 'node:os';
import path from 'node:path';

import { createEventId, createMessageId, createPartId, createSessionId } from './ids.js';
import { createEventTranslator, extractPromptImages, extractPromptText } from './event-translator.js';
import {
  THINKING_LEVELS,
  listPiCommands,
  listPiExtensions,
  listPiPackages,
  listPiPrompts,
  listPiSkills,
  readPiDefaults,
  readPiProjectTrust,
  setPiProjectTrust,
  toConfigSkillsPayload,
  writePiDefaults,
  writePiProjectTrust,
  writePiPrompt,
  deletePiPrompt,
  getPiAuthMethods,
  getPiProviderSources,
} from './pi-resources.js';
import {
  buildSessionHtml,
  buildSessionJsonl,
  cloneImportedMessages,
  parseSessionImport,
  sanitizeExportBasename,
} from './session-transfer.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const createInMemoryPiSession = ({
  sessionId = createSessionId(),
  chunks = ['Hello from ', 'the Pi mock kernel.'],
  chunkDelayMs = 5,
} = {}) => {
  const listeners = new Set();
  let streaming = false;
  let aborted = false;
  const messages = [];

  const emit = (event) => {
    for (const listener of Array.from(listeners)) {
      try {
        listener(event);
      } catch {
      }
    }
  };

  const runPrompt = async (text) => {
    streaming = true;
    aborted = false;
    messages.push({ role: 'user', content: text, timestamp: Date.now() });
    emit({ type: 'agent_start' });
    emit({ type: 'message_start', message: { role: 'assistant', content: [] } });
    emit({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_start', contentIndex: 0 },
    });

    let assembled = '';
    for (const chunk of chunks) {
      if (aborted) break;
      assembled += chunk;
      emit({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: chunk },
      });
      if (chunkDelayMs > 0) {
        await sleep(chunkDelayMs);
      }
    }

    if (!aborted) {
      emit({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_end', contentIndex: 0, content: assembled },
      });
      emit({
        type: 'message_end',
        message: { role: 'assistant', content: [{ type: 'text', text: assembled }] },
      });
      messages.push({ role: 'assistant', content: assembled, timestamp: Date.now() });
    }

    emit({ type: 'agent_end', messages: [], willRetry: false });
    emit({ type: 'agent_settled' });
    streaming = false;
  };

  return {
    sessionId,
    get isStreaming() {
      return streaming;
    },
    get messages() {
      return messages;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async prompt(text) {
      if (streaming) {
        throw new Error('Already streaming; use steer or followUp');
      }
      await runPrompt(text);
    },
    async steer(text) {
      if (!streaming) {
        await runPrompt(text);
        return;
      }
      emit({ type: 'queue_update', steering: [text], followUp: [] });
    },
    async followUp(text) {
      if (!streaming) {
        await runPrompt(text);
        return;
      }
      emit({ type: 'queue_update', steering: [], followUp: [text] });
    },
    async abort() {
      aborted = true;
      streaming = false;
      emit({ type: 'agent_settled' });
    },
    thinkingLevel: 'medium',
    currentModel: null,
    getAvailableThinkingLevels() {
      return ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
    },
    setThinkingLevel(level) {
      this.thinkingLevel = level;
    },
    setModel(model) {
      this.currentModel = model;
    },
    getContextUsage() {
      return { tokens: 0, contextLimit: 128000, percent: 0 };
    },
    async compact(instructions) {
      emit({ type: 'compaction_start', instructions: instructions || '' });
      emit({ type: 'compaction_end' });
    },
    dispose() {
      listeners.clear();
      streaming = false;
    },
  };
};

const defaultHome = () => os.homedir();

const createSessionInfo = ({
  id,
  directory,
  title,
  parentID,
  metadata,
  projectID,
}) => {
  const created = Date.now();
  return {
    id,
    projectID: projectID || directory || 'pi',
    directory,
    parentID,
    title: title || 'New session',
    version: 'pi',
    time: { created, updated: created },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    ...(metadata ? { metadata } : {}),
  };
};

const PLACEHOLDER_SESSION_TITLES = new Set(['new session', 'pi session', 'untitled']);

export const isPlaceholderSessionTitle = (title) => {
  const trimmed = typeof title === 'string' ? title.trim() : '';
  return !trimmed || PLACEHOLDER_SESSION_TITLES.has(trimmed.toLowerCase());
};

export const titleFromUserText = (text) => {
  const line = String(text || '').replace(/\s+/g, ' ').trim();
  if (!line) return '';
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}...` : line;
};

const firstUserText = (store) => {
  for (const entry of store.messages || []) {
    if (entry?.info?.role !== 'user') continue;
    const part = (entry.parts || []).find((item) => item?.type === 'text' && typeof item.text === 'string' && item.text.trim());
    if (part) return part.text;
  }
  return '';
};

const maybeApplyConversationTitle = (record) => {
  if (!record?.info || !isPlaceholderSessionTitle(record.info.title)) return false;
  const next = titleFromUserText(firstUserText(record));
  if (!next) return false;
  record.info.title = next;
  record.info.time = { ...(record.info.time || {}), updated: Date.now() };
  return true;
};

const lastUserMessage = (store) => {
  for (let index = store.messages.length - 1; index >= 0; index -= 1) {
    const entry = store.messages[index];
    if (entry?.info?.role === 'user' && entry.info.id) return entry;
  }
  return undefined;
};

const applyEventToStore = (store, ocEvent) => {
  const type = ocEvent?.type;
  const props = ocEvent?.properties || {};
  if (type === 'message.updated' && props.info) {
    const existing = store.messages.find((entry) => entry.info.id === props.info.id);
    if (existing) {
      const prevTime = existing.info.time || {};
      const nextTime = props.info.time || {};
      existing.info = {
        ...existing.info,
        ...props.info,
        time: {
          ...prevTime,
          ...nextTime,
          created: prevTime.created ?? nextTime.created,
        },
        parentID: props.info.parentID || existing.info.parentID,
        agent: props.info.agent || existing.info.agent,
        model: props.info.model || existing.info.model,
      };
    } else {
      store.messages.push({ info: props.info, parts: [] });
    }
  }
  if (type === 'message.part.updated' && props.part) {
    const messageID = props.part.messageID;
    let entry = store.messages.find((item) => item.info.id === messageID);
    if (!entry) {
      const parent = lastUserMessage(store);
      entry = {
        info: {
          id: messageID,
          sessionID: props.part.sessionID,
          role: 'assistant',
          time: { created: Date.now() },
          ...(parent?.info?.id ? { parentID: parent.info.id } : {}),
          ...(parent?.info?.agent ? { agent: parent.info.agent } : { agent: 'pi' }),
          ...(parent?.info?.model ? { model: parent.info.model } : {}),
        },
        parts: [],
      };
      store.messages.push(entry);
    }
    const index = entry.parts.findIndex((part) => part.id === props.part.id);
    if (index >= 0) {
      entry.parts[index] = props.part;
    } else if (
      entry.info.role === 'user'
      && props.part.type === 'text'
      && typeof props.part.text === 'string'
      && entry.parts.some((part) => part.type === 'text' && part.text === props.part.text)
    ) {
      // Pi message_start echo of the facade prompt — keep one text part.
    } else {
      entry.parts.push(props.part);
    }
  }
  if (type === 'message.part.delta') {
    const entry = store.messages.find((item) => item.info.id === props.messageID);
    if (!entry) return;
    const part = entry.parts.find((item) => item.id === props.partID);
    if (!part) return;
    const field = props.field || 'text';
    part[field] = `${part[field] || ''}${props.delta || ''}`;
  }
  if (type === 'session.status' && props.status) {
    store.status = props.status;
  }
  if (type === 'session.idle') {
    store.status = { type: 'idle' };
  }
};


export const normalizePiSessionUsage = (contextUsage, sessionStats) => {
  const usage = (contextUsage && typeof contextUsage === 'object')
    ? contextUsage
    : (sessionStats?.contextUsage && typeof sessionStats.contextUsage === 'object'
      ? sessionStats.contextUsage
      : undefined);
  if (!usage && !sessionStats) {
    return { available: false };
  }

  const rawTokens = usage?.tokens;
  const tokens = typeof rawTokens === 'number' && Number.isFinite(rawTokens) ? rawTokens : null;
  const contextLimit = [usage?.contextWindow, usage?.contextLimit]
    .find((value) => typeof value === 'number' && Number.isFinite(value) && value > 0) ?? 0;
  const rawPercent = usage?.percent;
  const percent = typeof rawPercent === 'number' && Number.isFinite(rawPercent)
    ? rawPercent
    : (tokens != null && contextLimit > 0 ? (tokens / contextLimit) * 100 : null);

  return {
    available: true,
    tokens,
    contextLimit,
    contextWindow: contextLimit || undefined,
    percent,
  };
};

export const mapPiModelsToProviders = (models) => {
  const byProvider = new Map();
  for (const model of models || []) {
    const providerID = model.provider || 'pi';
    if (!byProvider.has(providerID)) {
      byProvider.set(providerID, {
        id: providerID,
        name: providerID,
        source: 'pi',
        env: [],
        models: {},
      });
    }
    const provider = byProvider.get(providerID);
    const contextWindow = Number(model.contextWindow);
    const maxTokens = Number(model.maxTokens);
    const hasContext = Number.isFinite(contextWindow) && contextWindow > 0;
    const hasOutput = Number.isFinite(maxTokens) && maxTokens > 0;
    provider.models[model.id] = {
      id: model.id,
      name: model.name || model.id,
      reasoning: Boolean(model.reasoning),
      ...(hasContext ? { contextWindow } : {}),
      ...(hasOutput ? { maxTokens } : {}),
      cost: model.cost,
      ...(hasContext || hasOutput ? {
        limit: {
          ...(hasContext ? { context: contextWindow } : {}),
          ...(hasOutput ? { output: maxTokens } : {}),
        },
      } : {}),
    };
  }
  return Array.from(byProvider.values());
};

const loadPiSdk = async () => import('@earendil-works/pi-coding-agent');

const expandPromptTemplate = (template, argument) => {
  const source = typeof template === 'string' ? template : '';
  const args = typeof argument === 'string' ? argument : '';
  return source
    .replaceAll('$ARGUMENTS', args)
    .replaceAll('$@', args)
    .replaceAll('$1', args);
};

const createLocalReply = (emit) => (record, body, userText, assistantText) => {
  const sessionID = record.id;
  const userMessageID = body.messageID || createMessageId();
  const userAgent = typeof body.agent === 'string' && body.agent.trim() ? body.agent : 'pi';
  if (!record.messages.some((entry) => entry.info.id === userMessageID)) {
    const userPart = {
      id: createPartId(),
      sessionID,
      messageID: userMessageID,
      type: 'text',
      text: userText,
    };
    const userInfo = {
      id: userMessageID,
      sessionID,
      role: 'user',
      time: { created: Date.now() },
      agent: userAgent,
      ...(body.model ? { model: body.model } : {}),
    };
    record.messages.push({ info: userInfo, parts: [userPart] });
    emit(record.directory, {
      id: createEventId(),
      type: 'message.updated',
      properties: { sessionID, info: userInfo },
    });
    emit(record.directory, {
      id: createEventId(),
      type: 'message.part.updated',
      properties: { sessionID, part: userPart, time: Date.now() },
    });
  }

  const assistantID = createMessageId();
  const assistantInfo = {
    id: assistantID,
    sessionID,
    role: 'assistant',
    parentID: userMessageID,
    time: { created: Date.now(), completed: Date.now() },
    agent: 'pi',
    finish: 'stop',
  };
  const assistantPart = {
    id: createPartId(),
    sessionID,
    messageID: assistantID,
    type: 'text',
    text: assistantText,
  };
  record.messages.push({ info: assistantInfo, parts: [assistantPart] });
  emit(record.directory, {
    id: createEventId(),
    type: 'message.updated',
    properties: { sessionID, info: assistantInfo },
  });
  emit(record.directory, {
    id: createEventId(),
    type: 'message.part.updated',
    properties: { sessionID, part: assistantPart, time: Date.now() },
  });
  emit(record.directory, {
    id: createEventId(),
    type: 'session.idle',
    properties: { sessionID },
  });
  return { info: assistantInfo, parts: [assistantPart] };
};

export const createPiHost = ({
  createSession,
  createModelRuntime,
  createDirectoryRuntime,
  defaultDirectory = process.cwd(),
  home = defaultHome(),
  onEvent,
  mock = false,
} = {}) => {
  const sessions = new Map();
  const directoryRuntimes = new Map();
  let modelRuntime = null;
  let modelRuntimeError = null;
  let readyPromise = null;

  const emit = (directory, ocEvent) => {
    if (typeof onEvent === 'function') {
      onEvent(directory, ocEvent);
    }
  };
  const completeLocalReply = createLocalReply(emit);

  const resolveCreateSession = async () => {
    if (typeof createSession === 'function') return createSession;
    if (mock) {
      return async () => createInMemoryPiSession();
    }
    try {
      const pi = await loadPiSdk();
      return async ({ cwd, modelRuntime: runtime, model }) => {
        const { session } = await pi.createAgentSession({
          cwd,
          modelRuntime: runtime,
          ...(model ? { model } : {}),
          sessionManager: pi.SessionManager.inMemory(cwd),
        });
        return session;
      };
    } catch (error) {
      console.warn('[pi-host] @earendil-works/pi-coding-agent unavailable, using in-memory mock session:', error?.message || error);
      return async () => createInMemoryPiSession();
    }
  };

  const ensureModelRuntime = async () => {
    if (modelRuntime || mock) return modelRuntime;
    if (modelRuntimeError) throw modelRuntimeError;
    try {
      if (typeof createModelRuntime === 'function') {
        modelRuntime = await createModelRuntime();
      } else {
        const pi = await loadPiSdk();
        modelRuntime = await pi.ModelRuntime.create({ allowModelNetwork: false });
      }
    } catch (error) {
      modelRuntimeError = error;
      throw error;
    }
    return modelRuntime;
  };

  const ensureDirectoryRuntime = async (directory) => {
    if (directoryRuntimes.has(directory)) return directoryRuntimes.get(directory);
    if (typeof createDirectoryRuntime !== 'function' && mock) {
      const placeholder = { session: null, directory };
      directoryRuntimes.set(directory, placeholder);
      return placeholder;
    }
    try {
      if (typeof createDirectoryRuntime === 'function') {
        const runtime = await createDirectoryRuntime({ cwd: directory, modelRuntime });
        directoryRuntimes.set(directory, runtime);
        return runtime;
      }
      const pi = await loadPiSdk();
      if (typeof pi.createAgentSessionRuntime !== 'function') {
        const placeholder = { session: null, directory };
        directoryRuntimes.set(directory, placeholder);
        return placeholder;
      }
      const factory = async ({ cwd, sessionManager, sessionStartEvent }) => {
        const services = await pi.createAgentSessionServices({ cwd });
        return {
          ...(await pi.createAgentSessionFromServices({
            services,
            sessionManager,
            sessionStartEvent,
          })),
          services,
          diagnostics: services.diagnostics,
        };
      };
      const runtime = await pi.createAgentSessionRuntime(factory, {
        cwd: directory,
        agentDir: typeof pi.getAgentDir === 'function' ? pi.getAgentDir() : undefined,
        sessionManager: pi.SessionManager.inMemory(directory),
      });
      directoryRuntimes.set(directory, runtime);
      return runtime;
    } catch (error) {
      console.warn(`[pi-host] directory runtime unavailable for ${directory}:`, error?.message || error);
      const placeholder = { session: null, directory, error };
      directoryRuntimes.set(directory, placeholder);
      return placeholder;
    }
  };

  const ready = () => {
    if (!readyPromise) {
      readyPromise = (async () => {
        if (!mock) {
          try {
            await ensureModelRuntime();
          } catch (error) {
            console.warn('[pi-host] ModelRuntime unavailable:', error?.message || error);
          }
        }
        await ensureDirectoryRuntime(defaultDirectory);
        return true;
      })();
    }
    return readyPromise;
  };

  const attachSession = (record) => {
    const unsubscribe = record.piSession.subscribe((piEvent) => {
      const ocEvents = record.translator.translate(piEvent);
      for (const ocEvent of ocEvents) {
        applyEventToStore(record, ocEvent);
        record.info.time.updated = Date.now();
        emit(record.directory, ocEvent);
      }
    });
    record.unsubscribe = unsubscribe;
  };

  const createFacadeSession = async ({ directory, title, parentID, metadata, id } = {}) => {
    const cwd = directory || defaultDirectory;
    await ensureDirectoryRuntime(cwd);
    const factory = await resolveCreateSession();
    let model;
    try {
      const runtime = await ensureModelRuntime();
      const defaults = readPiDefaults(home);
      if (runtime && typeof runtime.getAvailable === 'function') {
        const available = await runtime.getAvailable();
        if (defaults.model && Array.isArray(available)) {
          const [providerID, modelID] = defaults.model.split('/');
          model = available.find((item) => (
            (item.id === defaults.model)
            || (item.id === modelID && (!providerID || item.provider === providerID))
          )) || available[0];
        } else {
          model = Array.isArray(available) && available.length > 0 ? available[0] : undefined;
        }
      }
    } catch {
    }

    const piSession = await factory({
      cwd,
      modelRuntime,
      model,
    });
    try {
      const defaults = readPiDefaults(home);
      if (typeof piSession?.setThinkingLevel === "function") {
        let level = defaults.thinking;
        if (typeof piSession.getAvailableThinkingLevels === "function") {
          const levels = piSession.getAvailableThinkingLevels();
          if (Array.isArray(levels) && levels.length > 0 && !levels.includes(level)) {
            level = levels.includes("medium") ? "medium" : levels[0];
          }
        }
        piSession.setThinkingLevel(level);
      }
    } catch {
    }
    const sessionID = id || createSessionId();
    const record = {
      id: sessionID,
      directory: cwd,
      info: createSessionInfo({
        id: sessionID,
        directory: cwd,
        title,
        parentID,
        metadata,
        projectID: cwd,
      }),
      messages: [],
      status: { type: 'idle' },
      piSession,
      translator: createEventTranslator({ sessionID, directory: cwd }),
      unsubscribe: null,
    };
    attachSession(record);
    sessions.set(sessionID, record);
    emit(cwd, {
      id: createSessionId().replace('ses_', 'evt_'),
      type: 'session.created',
      properties: { info: record.info },
    });
    return record;
  };

  const getRecord = (sessionID) => {
    const record = sessions.get(sessionID);
    if (!record) {
      const error = new Error(`Session not found: ${sessionID}`);
      error.status = 404;
      throw error;
    }
    return record;
  };

  return {
    ready,
    isMock() {
      return mock;
    },
    async createSession(input) {
      await ready();
      return createFacadeSession(input);
    },
    getSession(sessionID) {
      return getRecord(sessionID);
    },
    listSessions(directory) {
      const items = Array.from(sessions.values()).filter((record) => !directory || record.directory === directory);
      for (const record of items) {
        if (maybeApplyConversationTitle(record)) {
          emit(record.directory, {
            id: createEventId(),
            type: 'session.updated',
            properties: { info: record.info },
          });
        }
      }
      return items;
    },
    deleteSession(sessionID) {
      const record = getRecord(sessionID);
      try {
        record.unsubscribe?.();
        record.piSession?.dispose?.();
      } catch {
      }
      sessions.delete(sessionID);
      emit(record.directory, {
        type: 'session.deleted',
        properties: { info: record.info, sessionID },
      });
      return true;
    },
    updateSession(sessionID, patch = {}) {
      const record = getRecord(sessionID);
      if (typeof patch.title === 'string') {
        record.info.title = patch.title;
      }
      if (patch.metadata && typeof patch.metadata === 'object') {
        record.info.metadata = { ...(record.info.metadata || {}), ...patch.metadata };
      }
      if (patch.time?.archived) {
        record.info.time = { ...record.info.time, archived: patch.time.archived };
      }
      record.info.time.updated = Date.now();
      emit(record.directory, {
        type: 'session.updated',
        properties: { info: record.info },
      });
      return record;
    },
    getMessages(sessionID) {
      return getRecord(sessionID).messages;
    },
    getStatus(directory) {
      const map = {};
      for (const record of sessions.values()) {
        if (directory && record.directory !== directory) continue;
        if (record.status?.type && record.status.type !== 'idle') {
          map[record.id] = record.status;
        }
      }
      return map;
    },
    getPath(directory) {
      const cwd = directory || defaultDirectory;
      return {
        home,
        directory: cwd,
        worktree: cwd,
        state: path.join(home, '.pi', 'agent'),
        config: path.join(home, '.pi', 'agent'),
      };
    },
    listSkills(directory) {
      return listPiSkills({ home, directory: directory || defaultDirectory });
    },
    listPrompts(directory) {
      return listPiPrompts({ home, directory: directory || defaultDirectory });
    },
    listCommands(directory) {
      return listPiCommands({ home, directory: directory || defaultDirectory });
    },
    writeCommand(directory, name, config = {}) {
      return writePiPrompt({
        home,
        directory: directory || defaultDirectory,
        name,
        description: config.description,
        template: config.template,
        scope: config.scope === 'project' ? 'project' : 'user',
      });
    },
    deleteCommand(directory, name) {
      return deletePiPrompt({
        home,
        directory: directory || defaultDirectory,
        name,
      });
    },
    getDefaults() {
      return readPiDefaults(home);
    },
    setDefaults(patch = {}) {
      const mapped = { ...patch };
      if (typeof patch.defaultModel === 'string' && typeof patch.model !== 'string') {
        mapped.model = patch.defaultModel;
      }
      if (typeof patch.defaultVariant === 'string' && typeof patch.thinking !== 'string') {
        mapped.thinking = patch.defaultVariant;
      }
      return writePiDefaults(home, mapped);
    },
    getAuthMethods() {
      return getPiAuthMethods(home);
    },
    getProviderSources(providerId, directory) {
      return getPiProviderSources(providerId, {
        home,
        directory: directory || defaultDirectory,
      });
    },
    getKernelInfo() {
      const defaults = readPiDefaults(home);
      return {
        kernel: 'pi',
        product: 'Pichamber',
        mock,
        defaults,
        thinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
        paths: {
          home,
          agent: path.join(home, '.pi', 'agent'),
          models: path.join(home, '.pi', 'agent', 'models.json'),
          skills: path.join(home, '.pi', 'agent', 'skills'),
          prompts: path.join(home, '.pi', 'agent', 'prompts'),
        },
      };
    },
    getConfigSkills(directory) {
      return toConfigSkillsPayload(this.listSkills(directory));
    },
    async getProviders() {
      if (mock) {
        return {
          providers: [{
            id: 'pi-mock',
            name: 'Pi Mock',
            source: 'pi',
            env: [],
            models: {
              mock: { id: 'mock', name: 'Mock model' },
            },
          }],
          default: { 'pi-mock': 'mock' },
        };
      }
      try {
        const runtime = await ensureModelRuntime();
        const available = runtime && typeof runtime.getAvailable === 'function'
          ? await runtime.getAvailable()
          : [];
        const providers = mapPiModelsToProviders(available);
        const first = providers[0];
        const firstModel = first ? Object.keys(first.models)[0] : undefined;
        return {
          providers,
          default: first && firstModel ? { [first.id]: firstModel } : {},
        };
      } catch {
        return { providers: [], default: {} };
      }
    },
    async promptAsync(sessionID, body = {}) {
      const record = getRecord(sessionID);
      const text = extractPromptText(body.parts) || (typeof body.text === 'string' ? body.text : '');
      if (!text) {
        const error = new Error('Message must have at least one text part');
        error.status = 400;
        throw error;
      }

      const userMessageID = body.messageID || createMessageId();
      const userAgent = typeof body.agent === 'string' && body.agent.trim() ? body.agent : 'pi';
      record.translator.setUserMessage(userMessageID, {
        agent: userAgent,
        model: body.model,
      });
      const userPart = {
        id: createPartId(),
        sessionID,
        messageID: userMessageID,
        type: 'text',
        text,
      };
      const userInfo = {
        id: userMessageID,
        sessionID,
        role: 'user',
        time: { created: Date.now() },
        agent: userAgent,
        ...(body.model ? { model: body.model } : {}),
      };
      record.messages.push({ info: userInfo, parts: [userPart] });
      if (maybeApplyConversationTitle(record)) {
        emit(record.directory, {
          id: createEventId(),
          type: 'session.updated',
          properties: { info: record.info },
        });
      }
      emit(record.directory, {
        id: createEventId(),
        type: 'message.updated',
        properties: { sessionID, info: userInfo },
      });
      emit(record.directory, {
        id: createEventId(),
        type: 'message.part.updated',
        properties: { sessionID, part: userPart, time: Date.now() },
      });

      const images = extractPromptImages(body.parts);
      const promptOptions = {
        ...(images.length > 0 ? { images } : {}),
      };

      const isStreaming = Boolean(record.piSession.isStreaming);
      const delivery = body.delivery;
      const run = async () => {
        try {
          if (isStreaming && delivery === 'steer' && typeof record.piSession.steer === 'function') {
            await record.piSession.steer(text);
            return;
          }
          if (isStreaming && (delivery === 'followUp' || delivery === 'follow_up') && typeof record.piSession.followUp === 'function') {
            await record.piSession.followUp(text);
            return;
          }
          if (isStreaming && typeof record.piSession.steer === 'function') {
            await record.piSession.steer(text);
            return;
          }
          await record.piSession.prompt(text, promptOptions);
        } catch (error) {
          record.status = { type: 'idle' };
          emit(record.directory, {
            id: createEventId(),
            type: 'session.error',
            properties: { sessionID, error: { message: error?.message || String(error) } },
          });
          emit(record.directory, { id: createEventId(), type: 'session.idle', properties: { sessionID } });
        }
      };

      void run();
      return { info: userInfo, parts: [userPart] };
    },
    async abort(sessionID) {
      const record = getRecord(sessionID);
      await record.piSession.abort();
      return true;
    },
    async cloneSession(sessionID) {
      const source = getRecord(sessionID);
      const record = await createFacadeSession({
        directory: source.directory,
        title: source.info.title ? `${source.info.title} (copy)` : 'Cloned session',
        parentID: source.id,
      });
      record.messages = source.messages.map((entry) => ({
        info: { ...entry.info, sessionID: record.id },
        parts: (entry.parts || []).map((part) => ({ ...part, sessionID: record.id })),
      }));
      record.info.time.updated = Date.now();
      return record;
    },
    async listPersistedSessions(directory) {
      if (mock) return [];
      try {
        const pi = await loadPiSdk();
        if (typeof pi.SessionManager?.list !== 'function') return [];
        return await pi.SessionManager.list(directory || defaultDirectory);
      } catch {
        return [];
      }
    },
    async reload(directory) {
      modelRuntime = null;
      modelRuntimeError = null;
      readyPromise = null;

      for (const runtime of directoryRuntimes.values()) {
        try {
          runtime.dispose?.();
        } catch {
        }
      }
      directoryRuntimes.clear();

      const factory = await resolveCreateSession();
      try {
        await ensureModelRuntime();
      } catch {
      }

      for (const record of sessions.values()) {
        try {
          record.unsubscribe?.();
          if (typeof record.piSession?.reload === 'function') {
            await record.piSession.reload();
          } else {
            try {
              record.piSession?.dispose?.();
            } catch {
            }
            record.piSession = await factory({
              cwd: record.directory,
              modelRuntime,
            });
          }
          attachSession(record);
          emit(record.directory, {
            id: createEventId(),
            type: 'session.updated',
            properties: { info: record.info },
          });
        } catch (error) {
          console.warn(`[pi-host] reload failed for session ${record.id}:`, error?.message || error);
        }
      }

      await ready();

      const cwd = directory || defaultDirectory;
      const skills = listPiSkills({ home, directory: cwd });
      const commands = listPiCommands({ home, directory: cwd });
      emit(cwd, {
        id: createEventId(),
        type: 'server.connected',
        properties: { kernel: 'pi', reloaded: true },
      });

      return {
        reloaded: true,
        kernel: 'pi',
        sessions: sessions.size,
        skills: skills.length,
        commands: commands.length,
      };
    },
    async runCommand(sessionID, body = {}) {
      const record = getRecord(sessionID);
      const rawName = typeof body.command === 'string' ? body.command : '';
      const name = rawName.replace(/^\//, '').trim();
      const argument = typeof body.arguments === 'string' ? body.arguments.trim() : '';
      const userText = `/${[name, argument].filter(Boolean).join(' ')}`;

      const reply = async (assistantText) => completeLocalReply(record, body, userText, assistantText);

      if (name === 'reload') {
        const result = await this.reload(record.directory);
        return reply(
          `Reloaded Pi skills, prompts, and context files (${result.skills} skills, ${result.commands} commands).`,
        );
      }
      if (name === 'compact') {
        if (typeof record.piSession?.compact === 'function') {
          await record.piSession.compact(argument || undefined);
          return reply('Compacted session context.');
        }
        const defaults = readPiDefaults(home);
        return reply(
          defaults.compaction
            ? 'Pi compaction stays enabled and runs automatically when context is full.'
            : 'Pi compaction is disabled. Enable it in Settings → Sessions.',
        );
      }
      if (name === 'thinking') {
        const current = readPiDefaults(home);
        if (argument && THINKING_LEVELS.includes(argument)) {
          writePiDefaults(home, { thinking: argument });
          if (typeof record.piSession?.setThinkingLevel === 'function') {
            try { record.piSession.setThinkingLevel(argument); } catch {}
          }
          return reply(`Thinking level set to ${argument}.`);
        }
        return reply(
          `Current thinking level: ${current.thinking}. Valid levels: ${THINKING_LEVELS.join(', ')}.`,
        );
      }
      if (name === 'model') {
        const current = readPiDefaults(home);
        if (argument) {
          writePiDefaults(home, { model: argument });
          return reply(`Default model set to ${argument}.`);
        }
        return reply(
          current.model
            ? `Current default model: ${current.model}`
            : 'No default model set. Use /model provider/id or Settings → Sessions.',
        );
      }
      if (name === 'login') {
        return reply(
          'Pi authentication is managed in Settings → Providers and stored in ~/.pi/agent. Interactive /login is not run in this desktop UI.',
        );
      }

      const listed = listPiCommands({ home, directory: record.directory });
      const found = listed.find((item) => item.name === name && item.source === 'prompt' && item.template);
      if (found) {
        const text = expandPromptTemplate(found.template, argument);
        return this.promptAsync(sessionID, {
          ...body,
          parts: [{ type: 'text', text }],
        });
      }

      return this.promptAsync(sessionID, {
        ...body,
        parts: [{ type: 'text', text: userText }],
      });
    },
    listExtensions(directory) {
      return listPiExtensions({ home, directory: directory || defaultDirectory });
    },
    listPackages(directory) {
      return listPiPackages({ home, directory: directory || defaultDirectory });
    },
    getSessionTree(sessionID) {
      const record = getRecord(sessionID);
      return record.messages.map((entry) => {
        const textPart = (entry.parts || []).find((part) => part.type === "text" && typeof part.text === "string");
        const preview = String(textPart?.text || "").replace(/\s+/g, " ").trim().slice(0, 140);
        return {
          id: entry.info?.id,
          parentId: entry.info?.parentID || null,
          role: entry.info?.role || "user",
          preview,
          timestamp: entry.info?.time?.created || 0,
        };
      });
    },
    async forkSession(sessionID, messageID) {
      const source = getRecord(sessionID);
      const record = await createFacadeSession({
        directory: source.directory,
        title: source.info.title,
        parentID: source.id,
      });
      let messages = source.messages;
      if (typeof messageID === "string" && messageID.trim()) {
        const index = source.messages.findIndex((entry) => entry.info?.id === messageID);
        if (index >= 0) {
          messages = source.messages.slice(0, index + 1);
        }
      }
      record.messages = messages.map((entry) => ({
        info: { ...entry.info, sessionID: record.id },
        parts: (entry.parts || []).map((part) => ({ ...part, sessionID: record.id })),
      }));
      record.info.time.updated = Date.now();
      return record;
    },
    async setSessionThinking(sessionID, level) {
      const record = getRecord(sessionID);
      if (typeof record.piSession?.setThinkingLevel !== "function") {
        return { applied: false, thinking: level };
      }
      let next = THINKING_LEVELS.includes(level) ? level : null;
      if (typeof record.piSession.getAvailableThinkingLevels === "function") {
        const available = record.piSession.getAvailableThinkingLevels();
        if (Array.isArray(available) && available.length > 0) {
          if (!next || !available.includes(next)) {
            next = available.includes("medium") ? "medium" : available[0];
          }
        }
      }
      if (!next) {
        const error = new Error("Invalid thinking level");
        error.status = 400;
        throw error;
      }
      record.piSession.setThinkingLevel(next);
      return { applied: true, thinking: next };
    },
    async setSessionModel(sessionID, modelRef) {
      const record = getRecord(sessionID);
      if (typeof record.piSession?.setModel !== "function") {
        return { applied: false, model: modelRef };
      }
      const runtime = await ensureModelRuntime();
      if (!runtime || typeof runtime.getAvailable !== "function") {
        const error = new Error("Pi models are not available");
        error.status = 400;
        throw error;
      }
      const available = await runtime.getAvailable();
      const raw = typeof modelRef === "string" ? modelRef.trim() : "";
      const [providerID, modelID] = raw.split("/");
      const model = Array.isArray(available)
        ? available.find((item) => (
          item.id === raw
          || (item.id === modelID && (!providerID || item.provider === providerID))
        ))
        : null;
      if (!model) {
        const error = new Error("Unknown Pi model");
        error.status = 400;
        throw error;
      }
      record.piSession.setModel(model);
      return { applied: true, model: model.provider ? `${model.provider}/${model.id}` : model.id };
    },
    getSessionUsage(sessionID) {
      const record = getRecord(sessionID);
      let contextUsage;
      let sessionStats;
      try {
        if (typeof record.piSession?.getContextUsage === "function") {
          contextUsage = record.piSession.getContextUsage();
        }
      } catch {
      }
      try {
        if (typeof record.piSession?.getSessionStats === "function") {
          sessionStats = record.piSession.getSessionStats();
        }
      } catch {
      }
      return normalizePiSessionUsage(contextUsage, sessionStats);
    },
    async compactSession(sessionID, instructions) {
      const record = getRecord(sessionID);
      if (typeof record.piSession?.compact !== "function") {
        const error = new Error("Pi compact is not available on this session");
        error.status = 400;
        throw error;
      }
      await record.piSession.compact(typeof instructions === "string" && instructions.trim() ? instructions : undefined);
      return { compacted: true };
    },
    exportSession(sessionID, format = 'jsonl') {
      const record = getRecord(sessionID);
      const fmt = format === 'html' ? 'html' : 'jsonl';
      const basename = sanitizeExportBasename(record.info?.title);
      if (fmt === 'html') {
        return {
          format: 'html',
          filename: `${basename}.html`,
          mime: 'text/html; charset=utf-8',
          content: buildSessionHtml(record),
        };
      }
      return {
        format: 'jsonl',
        filename: `${basename}.jsonl`,
        mime: 'application/x-ndjson; charset=utf-8',
        content: buildSessionJsonl(record),
      };
    },
    async importSession({ jsonl, directory, title } = {}) {
      const parsed = parseSessionImport(jsonl);
      const cwd = directory || parsed.cwd || defaultDirectory;
      const record = await createFacadeSession({
        directory: cwd,
        title: (typeof title === 'string' && title.trim()) ? title.trim() : parsed.title,
      });
      record.messages = cloneImportedMessages(parsed.messages, record.id);
      record.info.time.updated = Date.now();
      return record;
    },
    getProjectTrust(directory) {
      return readPiProjectTrust(home, directory || defaultDirectory);
    },
    setProjectTrust(patch = {}, directory) {
      return writePiProjectTrust(home, patch, directory || defaultDirectory);
    },
    trustProject(directory, trusted) {
      const cwd = directory || defaultDirectory;
      setPiProjectTrust(home, cwd, trusted);
      return readPiProjectTrust(home, cwd);
    },
    dispose() {
      for (const record of sessions.values()) {
        try {
          record.unsubscribe?.();
          record.piSession?.dispose?.();
        } catch {
        }
      }
      sessions.clear();
    },
  };
};
