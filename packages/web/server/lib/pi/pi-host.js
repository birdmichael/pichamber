import os from 'node:os';
import path from 'node:path';

import { createMessageId, createPartId, createSessionId } from './ids.js';
import { createEventTranslator, extractPromptImages, extractPromptText } from './event-translator.js';

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

const applyEventToStore = (store, ocEvent) => {
  const type = ocEvent?.type;
  const props = ocEvent?.properties || {};
  if (type === 'message.updated' && props.info) {
    const existing = store.messages.find((entry) => entry.info.id === props.info.id);
    if (existing) {
      existing.info = { ...existing.info, ...props.info };
    } else {
      store.messages.push({ info: props.info, parts: [] });
    }
  }
  if (type === 'message.part.updated' && props.part) {
    const messageID = props.part.messageID;
    let entry = store.messages.find((item) => item.info.id === messageID);
    if (!entry) {
      entry = {
        info: {
          id: messageID,
          sessionID: props.part.sessionID,
          role: 'assistant',
          time: { created: Date.now() },
        },
        parts: [],
      };
      store.messages.push(entry);
    }
    const index = entry.parts.findIndex((part) => part.id === props.part.id);
    if (index >= 0) {
      entry.parts[index] = props.part;
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
    provider.models[model.id] = {
      id: model.id,
      name: model.name || model.id,
      reasoning: Boolean(model.reasoning),
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      cost: model.cost,
    };
  }
  return Array.from(byProvider.values());
};

const loadPiSdk = async () => import('@earendil-works/pi-coding-agent');

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
      if (runtime && typeof runtime.getAvailable === 'function') {
        const available = await runtime.getAvailable();
        model = Array.isArray(available) && available.length > 0 ? available[0] : undefined;
      }
    } catch {
    }

    const piSession = await factory({
      cwd,
      modelRuntime,
      model,
    });
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
      const items = Array.from(sessions.values());
      if (!directory) return items;
      return items.filter((record) => record.directory === directory);
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
      record.translator.setUserMessage(userMessageID);
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
        ...(body.agent ? { agent: body.agent } : {}),
        ...(body.model ? { model: body.model } : {}),
      };
      record.messages.push({ info: userInfo, parts: [userPart] });
      emit(record.directory, { type: 'message.updated', properties: { info: userInfo } });
      emit(record.directory, { type: 'message.part.updated', properties: { sessionID, part: userPart } });

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
            type: 'session.error',
            properties: { sessionID, error: { message: error?.message || String(error) } },
          });
          emit(record.directory, { type: 'session.idle', properties: { sessionID } });
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
