import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { enrichKnownModelEntry } from './known-model-capabilities.js';
import { createEventId, createMessageId, createPartId, createSessionId } from './ids.js';
import { createEventTranslator, extractPromptImages, extractPromptText } from './event-translator.js';
import {
  THINKING_LEVELS,
  listPiCommands,
  listPiExtensions,
  listPiPrompts,
  listPiSkills,
  getPiSkillDetail,
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
  hydrateKnownModelCapabilities,
  listPiProviderPublicConfigs,
  upsertPiProviderConfig,
  deletePiProviderConfig,
  writePiProviderAuth,
  removePiProviderAuth,
  resolvePiAgentDir,
  resolvePiAuthPath,
  resolvePiModelsPath,
} from './pi-resources.js';
import {
  createSdkPackageManager,
  createSettingsJsonPackageManager,
  isFeaturePluginSlot,
  listConfiguredPiPackageSources,
  listFeaturePluginSlashCommands,
  listPiPackages,
  readFeaturePlugins,
  toFeaturePluginsPayload,
  writeFeaturePlugins,
} from './feature-plugins.js';
import { enrichPiPackageVersions } from './pi-package-versions.js';
import { getPiUpgradeStatus, invalidatePiUpgradeStatusCache } from './pi-upgrade-status.js';
import { runPiSelfUpdate } from './pi-upgrade.js';
import {
  createAdapterMcpConfig,
  deleteAdapterMcpConfig,
  getAdapterMcpConfig,
  isMcpFeaturePluginActive,
  listAdapterMcpConfigs,
  setAdapterMcpEnabled,
  statusMapFromAdapterConfigs,
  statusMapFromAdapterSnapshot,
  updateAdapterMcpConfig,
} from './mcp-config.js';
import {
  attachMcpStatusListener,
  getRememberedMcpStatusSnapshot,
} from './mcp-status.js';
import {
  persistSessionMetadata,
  readPersistedArchivedTimestamp,
  readPersistedParentID,
  readPersistedSessionMetadata,
  readPersistedSessionMetadataFromFileTail,
  sessionTimeWithArchived,
} from './session-metadata.js';
import {
  findSessionJsonlInDir,
  isUnderSessionArchiveDir,
  relocateSessionFileForArchiveState,
  sessionArchiveDir,
} from './session-archive.js';
import { includeArchivedSessions } from './session-list-query.js';
import { createExtensionUIController } from './extension-ui.js';
import { adaptQuestionToolForDesktop } from './question-desktop.js';
import {
  PLAN_MODE_STATE_ENTRY_TYPE,
  applyMockPlanCommand,
  parseSessionPlanAction,
  restoreSessionPlanState,
  resumeSavedPlanState,
  sessionPlanFromState,
} from './session-plan.js';
import {
  isTodoSlotActive,
  mapTasksToOpenCodeTodos,
  replayTodosFromEntries,
} from './session-todo.js';
import {
  extractRunsFromFacadeMessages,
  extractRunsFromPiEntries,
  findAdapterRunByChildSessionId,
  isSubagentsSlotActive,
  listAdapterRunsFromFiles,
  readSessionIdFromSessionFile,
  reconcileParentSubagentRuns,
  toPublicSubagentRun,
} from './subagent-runs.js';
import {
  buildSessionHtml,
  buildSessionJsonl,
  cloneImportedMessages,
  facadeFilePartFromUnknown,
  facadeMessagesFromPiEntries,
  lastModelChangeFromMessages,
  parseSessionImport,
  persistFacadeMessages,
  resolveUsableFacadeModel,
  sanitizeExportBasename,
} from './session-transfer.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const RELOAD_WAIT_FOR_RESPONSE = 'Wait for the current response to finish before reloading.';
const RELOAD_WAIT_FOR_COMPACTION = 'Wait for compaction to finish before reloading.';

const sessionBlocksPiReload = (record) => {
  if (record?.piSession?.isStreaming) return RELOAD_WAIT_FOR_RESPONSE;
  if (record?.piSession?.isCompacting) return RELOAD_WAIT_FOR_COMPACTION;
  const statusType = record?.status?.type;
  if (statusType === 'busy' || statusType === 'retry') return RELOAD_WAIT_FOR_RESPONSE;
  return null;
};

const KERNEL_RELOAD_INTERRUPTED_KIND = 'opencode-restart-interrupted';
const KERNEL_RELOAD_INTERRUPTED_ERROR = {
  name: 'MessageAbortedError',
  message: 'The running turn was interrupted when the Pi kernel reloaded.',
};

const buildKernelReloadInterruptedNotification = (records) => {
  const sessionIds = records.map((record) => record.id);
  const first = records[0];
  const multiple = sessionIds.length > 1;
  return {
    title: multiple ? 'Chats interrupted' : 'Chat interrupted',
    body: multiple
      ? 'Pi restarted during running responses. Send a message in each chat to continue.'
      : 'Pi restarted during a running response. Send a message to continue.',
    tag: KERNEL_RELOAD_INTERRUPTED_KIND,
    kind: KERNEL_RELOAD_INTERRUPTED_KIND,
    sessionId: first?.id,
    directory: first?.directory,
  };
};

const asCustomToolList = (value) => {
  if (!value) return undefined;
  if (Array.isArray(value)) {
    const list = value.filter((tool) => tool && typeof tool.name === 'string');
    return list.length > 0 ? list : undefined;
  }
  if (typeof value === 'object') {
    const list = Object.values(value).filter((tool) => tool && typeof tool.name === 'string');
    return list.length > 0 ? list : undefined;
  }
  return undefined;
};

export const createInMemoryPiSession = ({
  sessionId = createSessionId(),
  chunks = ['Hello from ', 'the Pi mock kernel.'],
  chunkDelayMs = 5,
  compacting = false,
  planModeState = null,
  customTools,
} = {}) => {
  const listeners = new Set();
  const eventBusListeners = new Map();
  let streaming = false;
  let compactingFlag = compacting === true;
  let aborted = false;
  let reloadCount = 0;
  const messages = [];
  const extensionCommands = new Map();
  const sessionEntries = [];
  let customToolList = asCustomToolList(customTools) || [];
  let planState = planModeState && typeof planModeState === 'object'
    ? { ...planModeState }
    : { enabled: false, awaitingAction: false };

  const persistPlanState = () => {
    sessionEntries.push({
      type: 'custom',
      customType: PLAN_MODE_STATE_ENTRY_TYPE,
      data: planState,
    });
  };
  persistPlanState();
  const events = {
    on(name, listener) {
      const set = eventBusListeners.get(name) || new Set();
      set.add(listener);
      eventBusListeners.set(name, set);
    },
    off(name, listener) {
      eventBusListeners.get(name)?.delete(listener);
    },
    emit(name, payload) {
      for (const listener of Array.from(eventBusListeners.get(name) || [])) {
        listener(payload);
      }
    },
  };

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

  const tryExecuteExtensionCommand = async (text) => {
    if (typeof text !== 'string' || !text.startsWith('/')) return false;
    const spaceIndex = text.indexOf(' ');
    const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
    const args = spaceIndex === -1 ? '' : text.slice(spaceIndex + 1);
    const command = extensionCommands.get(commandName);
    if (!command) return false;
    await command.handler(args);
    return true;
  };

  const session = {
    sessionId,
    events,
    get isStreaming() {
      return streaming;
    },
    get isCompacting() {
      return compactingFlag;
    },
    get messages() {
      return messages;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getCommands() {
      return Array.from(extensionCommands.values()).map(({ handler: _handler, ...info }) => info);
    },
    getToolDefinition(name) {
      return customToolList.find((tool) => tool.name === name);
    },
    setCustomTools(next) {
      customToolList = asCustomToolList(next) || [];
    },
    registerCommand(name, handler, { description } = {}) {
      const commandName = typeof name === 'string' ? name.replace(/^\//, '').trim() : '';
      if (!commandName) return;
      extensionCommands.set(commandName, {
        name: commandName,
        description: typeof description === 'string' && description.trim() ? description.trim() : `/${commandName}`,
        source: 'extension',
        handler: typeof handler === 'function' ? handler : async () => {},
      });
    },
    getPlanModeState() {
      return planState;
    },
    setPlanModeState(next) {
      planState = next && typeof next === 'object' ? { ...next } : { enabled: false, awaitingAction: false };
      persistPlanState();
      return planState;
    },
    sessionManager: {
      getEntries() {
        return sessionEntries.slice();
      },
      getBranch() {
        return sessionEntries.slice();
      },
      appendCustomEntry(customType, data) {
        sessionEntries.push({ type: 'custom', customType, data });
        if (customType === PLAN_MODE_STATE_ENTRY_TYPE && data && typeof data === 'object') {
          planState = { ...data };
        }
      },
      appendEntry(entry) {
        if (entry) sessionEntries.push(entry);
      },
    },
    emitEvent(event) {
      emit(event);
    },
    async prompt(text, options = {}) {
      if (streaming) {
        throw new Error('Already streaming; use steer or followUp');
      }
      const expandPromptTemplates = options?.expandPromptTemplates ?? true;
      if (expandPromptTemplates && await tryExecuteExtensionCommand(text)) {
        return;
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
      compactingFlag = true;
      try {
        emit({ type: 'compaction_start', instructions: instructions || '' });
        emit({ type: 'compaction_end' });
      } finally {
        compactingFlag = false;
      }
    },
    async reload() {
      // Keep registered commands. Real AgentSession.reload() reloads extensions in place.
      reloadCount += 1;
      // Real AgentSession.reload() rebuilds the runner; stored bindings are not live until re-bound.
      this.extensionBindings = undefined;
    },
    get reloadCount() {
      return reloadCount;
    },
    get bindCount() {
      return this._bindCount || 0;
    },
    dispose() {
      listeners.clear();
      streaming = false;
    },
    async bindExtensions(bindings = {}) {
      this._bindCount = (this._bindCount || 0) + 1;
      this.extensionBindings = bindings;
    },
  };

  session.registerCommand('plan', async (args) => {
    const command = typeof args === 'string' ? args.trim().toLowerCase() : '';
    const ui = session.extensionBindings?.uiContext;
    // Real @narumitw/pi-plan-mode: `/plan start` enters and notifies.
    // It does not call select/confirm. Bare `/plan` and `/plan tools` do.
    if (command === 'start') {
      planState = applyMockPlanCommand(planState, command);
      persistPlanState();
      ui?.notify?.('Plan mode enabled. I will explore and plan, but not modify files.', 'info');
      return;
    }
    if (command === 'tools') {
      if (typeof ui?.select === 'function') {
        await ui.select('Plan-mode tools', [
          'bash',
          'find',
          'grep',
          'ls',
          'read',
          'Done — start Plan mode',
          'Back',
        ], { multiple: true });
      }
      return;
    }
    if (!command) {
      if (typeof ui?.select === 'function') {
        await ui.select('Plan mode\nStatus: Off…', [
          'Start Plan mode',
          'Choose tools, then start…',
          'Settings',
          'How Plan mode works',
        ]);
      }
      return;
    }
    planState = applyMockPlanCommand(planState, args);
    persistPlanState();
  }, { description: 'Enter or manage Plan mode' });

  return session;
};

const defaultHome = () => os.homedir();

export const sessionDirForCwd = (cwd, home = defaultHome()) => {
  const resolvedCwd = path.resolve(cwd || process.cwd());
  const safePath = `--${resolvedCwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
  return path.join(resolvePiAgentDir(home), 'sessions', safePath);
};

const findSessionFileById = (sessionID, home) => {
  const id = typeof sessionID === 'string' ? sessionID.trim() : '';
  if (!id) return undefined;
  const root = path.join(resolvePiAgentDir(home), 'sessions');
  if (!fs.existsSync(root)) return undefined;
  let projects;
  try {
    projects = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const project of projects) {
    if (!project.isDirectory() && !project.isSymbolicLink()) continue;
    const dir = path.join(root, project.name);
    const active = findSessionJsonlInDir(dir, id);
    if (active) return active;
    const archived = findSessionJsonlInDir(sessionArchiveDir(dir), id);
    if (archived) return archived;
  }
  return undefined;
};

const writeSessionHeaderIfMissing = (manager, { version } = {}) => {
  const file = typeof manager?.getSessionFile === 'function' ? manager.getSessionFile() : undefined;
  if (!file) return undefined;
  if (fs.existsSync(file)) return file;
  const header = {
    type: 'session',
    ...(version != null ? { version } : {}),
    id: manager.getSessionId(),
    timestamp: new Date().toISOString(),
    cwd: typeof manager.getCwd === 'function' ? manager.getCwd() : undefined,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(header)}\n`);
  return file;
};

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
    time: sessionTimeWithArchived({ created, updated: created }, metadata),
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    ...(metadata ? { metadata } : {}),
  };
};

const PLACEHOLDER_SESSION_TITLES = new Set([
  'new session',
  'pi session',
  'untitled',
  'untitled session',
  '(no messages)',
  'no messages',
]);

export const isPlaceholderSessionTitle = (title) => {
  const trimmed = typeof title === 'string' ? title.trim() : '';
  return !trimmed || PLACEHOLDER_SESSION_TITLES.has(trimmed.toLowerCase());
};

export const resolveListedSessionTitle = (item) => {
  const name = typeof item?.name === 'string' ? item.name.trim() : '';
  if (name && !isPlaceholderSessionTitle(name)) return name;
  const firstMessage = typeof item?.firstMessage === 'string' ? item.firstMessage.trim() : '';
  if (firstMessage && !isPlaceholderSessionTitle(firstMessage)) {
    return titleFromUserText(firstMessage) || 'New session';
  }
  return 'New session';
};

export const resolvePromptModelRef = (model) => {
  if (typeof model === 'string' && model.trim()) return model.trim();
  if (!model || typeof model !== 'object') return '';
  const providerID = typeof model.providerID === 'string' ? model.providerID.trim() : '';
  const modelID = typeof model.modelID === 'string'
    ? model.modelID.trim()
    : (typeof model.id === 'string' ? model.id.trim() : '');
  if (providerID && modelID) return `${providerID}/${modelID}`;
  return modelID;
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

const resolveStoreRuntimeModel = (store, ...extras) => resolveUsableFacadeModel(
  ...extras,
  store?.translator?.getFallbackModel?.(),
  lastModelChangeFromMessages(store?.messages),
  store?.piSession?.currentModel,
);

const stampAssistantStoreInfo = (info, store, extra) => {
  const usable = resolveStoreRuntimeModel(store, extra, info);
  if (usable) {
    return {
      ...info,
      providerID: usable.providerID,
      modelID: usable.modelID,
      model: usable.model,
    };
  }
  if (info?.providerID === 'pi' && info?.modelID === 'pi') {
    const next = { ...info };
    delete next.providerID;
    delete next.modelID;
    if (next.model?.providerID === 'pi' && next.model?.modelID === 'pi') delete next.model;
    return next;
  }
  return info;
};

const applyEventToStore = (store, ocEvent) => {
  const type = ocEvent?.type;
  const props = ocEvent?.properties || {};
  if (type === 'message.updated' && props.info) {
    const existing = store.messages.find((entry) => entry.info.id === props.info.id);
    const nextInfo = stampAssistantStoreInfo(props.info, store, existing?.info);
    if (existing) {
      const prevTime = existing.info.time || {};
      const nextTime = nextInfo.time || {};
      existing.info = {
        ...existing.info,
        ...nextInfo,
        time: {
          ...prevTime,
          ...nextTime,
          created: prevTime.created ?? nextTime.created,
        },
        parentID: nextInfo.parentID || existing.info.parentID,
        agent: nextInfo.agent || existing.info.agent,
        model: nextInfo.model || existing.info.model,
      };
      const usable = resolveStoreRuntimeModel(store, existing.info);
      if (usable) {
        existing.info.providerID = usable.providerID;
        existing.info.modelID = usable.modelID;
        existing.info.model = usable.model;
      }
    } else {
      store.messages.push({ info: nextInfo, parts: [] });
    }
  }
  if (type === 'message.part.updated' && props.part) {
    const messageID = props.part.messageID;
    let entry = store.messages.find((item) => item.info.id === messageID);
    if (!entry) {
      const parent = lastUserMessage(store);
      const stub = {
        id: messageID,
        sessionID: props.part.sessionID,
        role: 'assistant',
        time: { created: Date.now() },
        ...(parent?.info?.id ? { parentID: parent.info.id } : {}),
        ...(parent?.info?.agent ? { agent: parent.info.agent } : { agent: 'pi' }),
      };
      entry = {
        info: stampAssistantStoreInfo(stub, store, parent?.info),
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

const readAvailableThinkingLevels = (piSession) => {
  if (typeof piSession?.getAvailableThinkingLevels !== 'function') {
    return [];
  }
  try {
    const levels = piSession.getAvailableThinkingLevels();
    if (!Array.isArray(levels)) return [];
    const next = [];
    const seen = new Set();
    for (const item of levels) {
      if (typeof item !== 'string') continue;
      const level = item.trim();
      if (!THINKING_LEVELS.includes(level) || seen.has(level)) continue;
      seen.add(level);
      next.push(level);
    }
    return next;
  } catch {
    return [];
  }
};

const readSessionThinking = (piSession) => {
  const available = readAvailableThinkingLevels(piSession);
  const current = typeof piSession?.thinkingLevel === 'string' ? piSession.thinkingLevel.trim() : '';
  return {
    thinking: THINKING_LEVELS.includes(current) ? current : undefined,
    available,
  };
};

const PI_MODEL_INPUT_TYPES = new Set(['text', 'image']);

const readPiModelInput = (model) => {
  if (!model || typeof model !== 'object' || Array.isArray(model)) return undefined;
  const value = model.input;
  if (!Array.isArray(value)) return undefined;
  const next = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const token = item.trim().toLowerCase();
    if (!PI_MODEL_INPUT_TYPES.has(token) || seen.has(token)) continue;
    seen.add(token);
    next.push(token);
  }
  return next.length > 0 ? next : undefined;
};

const capabilitiesFromPiInput = (input, reasoning) => ({
  reasoning: Boolean(reasoning),
  attachment: input.includes('image'),
  input: {
    text: input.includes('text'),
    image: input.includes('image'),
    audio: false,
    video: false,
    pdf: false,
  },
});

const isPiDefaultTextInput = (input) => (
  Array.isArray(input) && input.length === 1 && input[0] === 'text'
);

const toProviderModelRecord = (model) => {
  const id = typeof model?.id === 'string' ? model.id.trim() : '';
  if (!id) return null;
  const enriched = enrichKnownModelEntry(id, model).model;
  const contextWindow = Number(enriched.contextWindow ?? model.contextWindow);
  const maxTokens = Number(enriched.maxTokens ?? model.maxTokens);
  const hasContext = Number.isFinite(contextWindow) && contextWindow > 0;
  const hasOutput = Number.isFinite(maxTokens) && maxTokens > 0;
  const input = readPiModelInput(enriched);
  return {
    id,
    name: typeof (enriched.name ?? model.name) === 'string' && String(enriched.name ?? model.name).trim()
      ? String(enriched.name ?? model.name).trim()
      : id,
    reasoning: enriched.reasoning === true,
    ...(hasContext ? { contextWindow } : {}),
    ...(hasOutput ? { maxTokens } : {}),
    ...(input || model.reasoning === true ? {
      ...(input ? { input } : {}),
      capabilities: capabilitiesFromPiInput(input || ['text'], enriched.reasoning),
    } : {}),
    cost: model.cost,
    ...(hasContext || hasOutput ? {
      limit: {
        ...(hasContext ? { context: contextWindow } : {}),
        ...(hasOutput ? { output: maxTokens } : {}),
      },
    } : {}),
  };
};

const applyPublicProviderConfig = (provider, config) => {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return provider;
  }
  if (typeof config.name === 'string' && config.name.trim()) {
    provider.name = config.name.trim();
  }
  const baseURL = typeof config.baseUrl === 'string' ? config.baseUrl.trim() : '';
  const headers = config.headers && typeof config.headers === 'object' && !Array.isArray(config.headers)
    ? config.headers
    : null;
  if (baseURL) {
    provider.options = {
      ...(provider.options && typeof provider.options === 'object' ? provider.options : {}),
      baseURL,
      ...(headers ? { headers } : {}),
    };
  }
  if (typeof config.api === 'string' && config.api.trim()) {
    provider.api = config.api.trim();
  }
  if (Array.isArray(config.env)) {
    const env = config.env
      .filter((entry) => typeof entry === 'string' && entry.trim())
      .map((entry) => entry.trim());
    if (env.length > 0) {
      provider.env = env;
    }
  }
  const extraModels = Array.isArray(config.models) ? config.models : [];
  for (const extra of extraModels) {
    const record = toProviderModelRecord(extra);
    if (!record) continue;
    const existing = provider.models[record.id];
    if (!existing) {
      provider.models[record.id] = record;
      continue;
    }
    const existingLimit = existing.limit && typeof existing.limit === 'object' ? existing.limit : {};
    const existingContext = existing.contextWindow || existingLimit.context;
    const existingOutput = existing.maxTokens || existingLimit.output;
    const existingInputRaw = readPiModelInput(existing);
    const existingInput = isPiDefaultTextInput(existingInputRaw) ? undefined : existingInputRaw;
    const existingReasoning = existing.reasoning === true || existing.capabilities?.reasoning === true;
    const contextWindow = existingContext || record.contextWindow;
    const maxTokens = existingOutput || record.maxTokens;
    const input = existingInput || record.input;
    const reasoning = existingReasoning || record.reasoning === true;
    const hasContext = Number.isFinite(Number(contextWindow)) && Number(contextWindow) > 0;
    const hasOutput = Number.isFinite(Number(maxTokens)) && Number(maxTokens) > 0;
    const hasInput = Array.isArray(input) && input.length > 0;
    if (!hasContext && !hasOutput && !hasInput && !reasoning) continue;
    provider.models[record.id] = {
      ...existing,
      ...(reasoning && !existingReasoning ? { reasoning: true } : {}),
      ...(hasContext && !existingContext ? { contextWindow: Number(contextWindow) } : {}),
      ...(hasOutput && !existingOutput ? { maxTokens: Number(maxTokens) } : {}),
      ...((hasInput && !existingInput) || (reasoning && !existingReasoning) ? {
        ...(hasInput && !existingInput ? { input } : {}),
        capabilities: {
          ...(existing.capabilities && typeof existing.capabilities === 'object' ? existing.capabilities : {}),
          ...capabilitiesFromPiInput(input || existingInput || ['text'], reasoning),
        },
      } : {}),
      ...(hasContext || hasOutput ? {
        limit: {
          ...existingLimit,
          ...(hasContext && !existingLimit.context ? { context: Number(contextWindow) } : {}),
          ...(hasOutput && !existingLimit.output ? { output: Number(maxTokens) } : {}),
        },
      } : {}),
    };
  }
  return provider;
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

export const mapPiModelsToProviders = (models, { configs = {} } = {}) => {
  const byProvider = new Map();
  for (const model of models || []) {
    const providerID = typeof model.provider === 'string' && model.provider.trim()
      ? model.provider.trim()
      : 'pi';
    if (!byProvider.has(providerID)) {
      byProvider.set(providerID, {
        id: providerID,
        name: providerID,
        source: 'pi',
        env: [],
        models: {},
      });
    }
    const record = toProviderModelRecord(model);
    if (record) {
      byProvider.get(providerID).models[record.id] = record;
    }
  }
  for (const [id, config] of Object.entries(configs || {})) {
    if (!id) continue;
    if (!byProvider.has(id)) {
      byProvider.set(id, {
        id,
        name: id,
        source: 'pi',
        env: [],
        models: {},
      });
    }
    applyPublicProviderConfig(byProvider.get(id), config);
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

const commandNameOf = (command) => (
  typeof command?.name === 'string' ? command.name.trim() : ''
);

const isExtensionCommandSource = (source) => (
  source !== 'prompt' && source !== 'skill' && source !== 'builtin'
);

/** Live session getCommands() / extensionRunner.registerCommand results. */
export const readLiveSessionCommands = (piSession) => {
  if (!piSession || typeof piSession !== 'object') return [];
  if (typeof piSession.getCommands === 'function') {
    try {
      const commands = piSession.getCommands();
      return Array.isArray(commands) ? commands : [];
    } catch {
      return [];
    }
  }
  const registered = piSession.extensionRunner?.getRegisteredCommands?.();
  if (!Array.isArray(registered)) return [];
  return registered.map((command) => ({
    name: command.invocationName || command.name,
    description: command.description || '',
    source: command.source || 'extension',
  }));
};

export const toFacadeExtensionCommand = (command) => {
  const name = commandNameOf(command);
  if (!name || name === 'reload' || !isExtensionCommandSource(command?.source)) return null;
  return {
    name,
    description: typeof command.description === 'string' && command.description.trim()
      ? command.description.trim()
      : `/${name}`,
    source: 'extension',
    template: '',
    agent: 'pi',
  };
};

export const mergeLiveExtensionCommands = (listed, live) => {
  const merged = Array.isArray(listed) ? [...listed] : [];
  const indexByName = new Map(merged.map((item, index) => [item.name, index]));
  for (const command of Array.isArray(live) ? live : []) {
    const entry = toFacadeExtensionCommand(command);
    if (!entry) continue;
    const existingIndex = indexByName.get(entry.name);
    if (existingIndex == null) {
      indexByName.set(entry.name, merged.length);
      merged.push(entry);
      continue;
    }
    const existing = merged[existingIndex];
    if (existing.source === 'builtin') continue;
    // Extension handlers overlay the slash name, but Settings still edits the
    // markdown prompt body. An empty extension template must not wipe it.
    const existingTemplate = typeof existing.template === 'string' ? existing.template : '';
    merged[existingIndex] = {
      ...entry,
      template: existingTemplate.length > 0 ? existingTemplate : entry.template,
      path: existing.path || entry.path,
      scope: existing.scope || entry.scope,
    };
  }
  return merged;
};

const findLiveSessionCommand = (piSession, name) => (
  readLiveSessionCommands(piSession).find((item) => commandNameOf(item) === name)
);

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
  createPackageManager,
  defaultDirectory = process.cwd(),
  home = defaultHome(),
  onEvent,
  mock = false,
  readListSessionMetadata,
  listPersistedSessionsInDir,
  getCustomTools,
  runSelfUpdate,
} = {}) => {
  const sessions = new Map();
  const sessionTodos = new Map();
  const hydrating = new Map();
  const directoryRuntimes = new Map();
  let modelRuntime = null;
  let modelRuntimeError = null;
  let readyPromise = null;
  const resolveAgentDir = () => resolvePiAgentDir(home);
  const selfUpdate = typeof runSelfUpdate === 'function'
    ? runSelfUpdate
    : (mock
      ? async () => ({ ok: true, command: 'pi update' })
      : runPiSelfUpdate);

  const emit = (directory, ocEvent) => {
    if (typeof onEvent === 'function') {
      onEvent(directory, ocEvent);
    }
  };
  const completeLocalReply = createLocalReply(emit);

  const resolveCustomTools = async () => {
    if (typeof getCustomTools !== 'function') return undefined;
    return asCustomToolList(await getCustomTools());
  };

  const invokeSessionFactory = async (factory, args) => {
    const customTools = await resolveCustomTools();
    const session = await factory({ ...args, customTools });
    if (typeof session?.setCustomTools === 'function') {
      session.setCustomTools(customTools);
    }
    return session;
  };

  const listSessionsInDir = typeof listPersistedSessionsInDir === 'function'
    ? listPersistedSessionsInDir
    : async (cwd, dir) => {
      const pi = await loadPiSdk();
      if (typeof pi.SessionManager?.list !== 'function') return [];
      if (typeof dir !== 'string' || !dir || !fs.existsSync(dir)) return [];
      return await pi.SessionManager.list(cwd, dir);
    };

  const listPersistedSessionItems = async (cwd, { includeArchived = false } = {}) => {
    const sessionDir = sessionDirForCwd(cwd, home);
    const items = [];
    try {
      items.push(...(await listSessionsInDir(cwd, sessionDir) || []));
    } catch {
      // Active-dir list failed: keep going. Do not pretend the directory is empty
      // if archive/ or live sessions still have rows.
    }
    if (includeArchived) {
      try {
        items.push(...(await listSessionsInDir(cwd, sessionArchiveDir(sessionDir)) || []));
      } catch {
        // Archive-dir list failed: keep active rows.
      }
    }
    return items;
  };

  const retargetRecordSessionFile = (record, nextFile) => {
    if (!record || typeof nextFile !== 'string' || !nextFile || record.sessionFile === nextFile) {
      return record;
    }
    record.sessionFile = nextFile;
    try {
      if (typeof record.sessionManager?.setSessionFile === 'function') {
        record.sessionManager.setSessionFile(nextFile);
      }
    } catch {
    }
    return record;
  };

  const relocateListedArchivedItem = (item, info, directory) => {
    if (!item?.path || !info?.time?.archived) return item;
    const sessionDir = sessionDirForCwd(item.cwd || directory || defaultDirectory, home);
    if (isUnderSessionArchiveDir(item.path, sessionDir)) return item;
    const moved = relocateSessionFileForArchiveState(item.path, sessionDir, true);
    if (moved === item.path) return item;
    const live = sessions.get(info.id);
    if (live) retargetRecordSessionFile(live, moved);
    return { ...item, path: moved };
  };

  const resolveCreateSession = async () => {
    if (typeof createSession === 'function') return createSession;
    if (mock) {
      return async () => createInMemoryPiSession();
    }
    try {
      const pi = await loadPiSdk();
      return async ({ cwd, modelRuntime: runtime, model, sessionManager, customTools }) => {
        const { session } = await pi.createAgentSession({
          cwd,
          agentDir: resolveAgentDir(),
          modelRuntime: runtime,
          ...(model ? { model } : {}),
          sessionManager: sessionManager || pi.SessionManager.create(cwd, sessionDirForCwd(cwd, home)),
          ...(customTools ? { customTools } : {}),
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
      hydrateKnownModelCapabilities({ home, directory: defaultDirectory });
      if (typeof createModelRuntime === 'function') {
        modelRuntime = await createModelRuntime();
      } else {
        const pi = await loadPiSdk();
        const agentDir = resolveAgentDir();
        modelRuntime = await pi.ModelRuntime.create({
          allowModelNetwork: false,
          authPath: resolvePiAuthPath(home),
          modelsPath: resolvePiModelsPath(home),
          agentDir,
        });
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
        const runtime = await createDirectoryRuntime({
          cwd: directory,
          modelRuntime,
          customTools: await resolveCustomTools(),
        });
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
        const customTools = await resolveCustomTools();
        const services = await pi.createAgentSessionServices({ cwd });
        return {
          ...(await pi.createAgentSessionFromServices({
            services,
            sessionManager,
            sessionStartEvent,
            ...(customTools ? { customTools } : {}),
          })),
          services,
          diagnostics: services.diagnostics,
        };
      };
      const runtime = await pi.createAgentSessionRuntime(factory, {
        cwd: directory,
        agentDir: resolveAgentDir(),
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

  const readRecordEntriesOrThrow = (record) => {
    const manager = record?.sessionManager || record?.piSession?.sessionManager;
    try {
      if (typeof manager?.getEntries === 'function') {
        const entries = manager.getEntries();
        if (!Array.isArray(entries)) {
          const error = new Error(`Failed to read session entries for ${record.id}`);
          error.status = 500;
          throw error;
        }
        return entries;
      }
      if (typeof manager?.getBranch === 'function') {
        const entries = manager.getBranch();
        if (!Array.isArray(entries)) {
          const error = new Error(`Failed to read session entries for ${record.id}`);
          error.status = 500;
          throw error;
        }
        return entries;
      }
    } catch (error) {
      if (error?.status) throw error;
      const wrapped = new Error(error?.message || `Failed to read session entries for ${record.id}`);
      wrapped.status = 500;
      throw wrapped;
    }
    return [];
  };

  const publishRecordTodos = (record, entries) => {
    if (!Array.isArray(entries)) {
      const error = new Error(`Failed to read todo snapshot for session ${record.id}`);
      error.status = 500;
      throw error;
    }
    const todos = mapTasksToOpenCodeTodos(replayTodosFromEntries(entries).tasks);
    sessionTodos.set(record.id, todos);
    emit(record.directory, {
      id: createEventId(),
      type: 'todo.updated',
      properties: { sessionID: record.id, todos },
    });
    return todos;
  };

  const syncRecordTodos = (record) => publishRecordTodos(record, readRecordEntriesOrThrow(record));

  const emitTranslated = (record, piEvent) => {
    const ocEvents = record.translator.translate(piEvent);
    for (const ocEvent of ocEvents) {
      applyEventToStore(record, ocEvent);
      record.info.time.updated = Date.now();
      emit(record.directory, ocEvent);
      if (ocEvent.type === 'todo.updated' && Array.isArray(ocEvent.properties?.todos)) {
        sessionTodos.set(record.id, ocEvent.properties.todos);
      }
    }
    if (
      piEvent?.type === 'compaction_end'
      && piEvent.aborted !== true
      && !(typeof piEvent.errorMessage === 'string' && piEvent.errorMessage.trim())
    ) {
      try {
        syncRecordTodos(record);
      } catch {
        // Keep the last good snapshot. Do not replace a failed replay with [].
      }
    }
    return ocEvents;
  };

  const sessionIsLive = (record) => (
    Boolean(record?.piSession?.isStreaming) || Boolean(record?.piSession?.isCompacting)
  );

  const settleRecordIfStuck = (record) => {
    if (!record || sessionIsLive(record)) return false;
    if (record.status?.type !== 'busy' && record.status?.type !== 'retry') return false;
    emitTranslated(record, { type: 'agent_settled' });
    return true;
  };

  const forceSettleRecord = (record) => {
    if (!record) return;
    try {
      record.extensionUI?.cancelAll?.();
    } catch {
    }
    emitTranslated(record, { type: 'agent_settled' });
  };

  const interruptRecordForKernelReload = async (record) => {
    try {
      record.extensionUI?.cancelAll?.();
    } catch {
    }
    try {
      await record.piSession?.abort?.();
    } catch {
    }
    forceSettleRecord(record);
    emit(record.directory, {
      id: createEventId(),
      type: 'session.error',
      properties: {
        sessionID: record.id,
        error: KERNEL_RELOAD_INTERRUPTED_ERROR,
      },
    });
  };

  const attachSession = (record) => {
    const unsubscribe = record.piSession.subscribe((piEvent) => {
      emitTranslated(record, piEvent);
    });
    const detachMcpStatus = attachMcpStatusListener(record);
    record.unsubscribe = () => {
      unsubscribe?.();
      detachMcpStatus?.();
    };
  };

  const ensureQuestionToolAdapted = (record) => {
    adaptQuestionToolForDesktop(record?.piSession, record?.extensionUI?.context);
  };

  const bindDesktopExtensionUI = async (record) => {
    if (!record?.piSession || typeof record.piSession.bindExtensions !== 'function') {
      return record;
    }
    try {
      record.extensionUI?.dispose?.();
    } catch {
    }
    record.extensionUI = createExtensionUIController({
      sessionID: record.id,
      directory: record.directory,
      emit,
    });
    try {
      await record.piSession.bindExtensions({
        uiContext: record.extensionUI.context,
        mode: 'rpc',
      });
      ensureQuestionToolAdapted(record);
    } catch (error) {
      console.warn(`[pi-host] bindExtensions failed for ${record.id}:`, error?.message || error);
    }
    return record;
  };

  const getExtensionUI = (sessionID) => {
    const record = sessions.get(sessionID);
    return record?.extensionUI || null;
  };

  const resolvePreferredModel = async () => {
    try {
      const runtime = await ensureModelRuntime();
      const defaults = readPiDefaults(home);
      if (runtime && typeof runtime.getAvailable === 'function') {
        const available = await runtime.getAvailable();
        if (defaults.model && Array.isArray(available)) {
          const [providerID, modelID] = defaults.model.split('/');
          return available.find((item) => (
            (item.id === defaults.model)
            || (item.id === modelID && (!providerID || item.provider === providerID))
          )) || available[0];
        }
        return Array.isArray(available) && available.length > 0 ? available[0] : undefined;
      }
    } catch {
    }
    return undefined;
  };

  const resolveHostFallbackModel = (record, extra) => resolveUsableFacadeModel(
    extra,
    record?.piSession?.currentModel,
    lastModelChangeFromMessages(record?.messages),
    readPiDefaults(home).model,
  );

  const createRecordTranslator = (sessionID, directory, record) => createEventTranslator({
    sessionID,
    directory,
    fallbackModel: resolveHostFallbackModel(record),
  });

  const hydrateFacadeMessages = (entries, sessionID, record) => facadeMessagesFromPiEntries(entries, sessionID, {
    fallbackModel: resolveHostFallbackModel(record),
  });

  const createPersistedSessionManager = async (cwd, { title } = {}) => {
    try {
      const pi = await loadPiSdk();
      if (typeof pi.SessionManager?.create !== 'function') return null;
      const sessionDir = sessionDirForCwd(cwd, home);
      let manager = pi.SessionManager.create(cwd, sessionDir);
      const file = writeSessionHeaderIfMissing(manager, {
        version: pi.CURRENT_SESSION_VERSION,
      });
      if (file && typeof pi.SessionManager.open === 'function') {
        manager = pi.SessionManager.open(file, sessionDir);
      }
      if (title && !isPlaceholderSessionTitle(title) && typeof manager.appendSessionInfo === 'function') {
        manager.appendSessionInfo(title);
      }
      return manager;
    } catch (error) {
      console.warn('[pi-host] SessionManager persist unavailable:', error?.message || error);
      return null;
    }
  };

  const createFacadeSession = async ({ directory, title, parentID, metadata, id } = {}) => {
    const cwd = directory || defaultDirectory;
    await ensureDirectoryRuntime(cwd);
    const factory = await resolveCreateSession();
    const model = await resolvePreferredModel();
    const sessionManager = mock ? null : await createPersistedSessionManager(cwd, { title });

    const piSession = await invokeSessionFactory(factory, {
      cwd,
      modelRuntime,
      model,
      sessionManager,
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
    const persistedId = typeof sessionManager?.getSessionId === 'function'
      ? sessionManager.getSessionId()
      : undefined;
    const liveId = typeof piSession?.sessionId === 'string' && piSession.sessionId.trim()
      ? piSession.sessionId.trim()
      : undefined;
    const sessionID = persistedId || liveId || id || createSessionId();
    const resolvedParentID = typeof parentID === 'string' && parentID.trim() ? parentID.trim() : undefined;
    const sessionMetadata = {
      ...(metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}),
      ...(resolvedParentID ? { parentID: resolvedParentID } : {}),
    };
    const hasMetadata = Object.keys(sessionMetadata).length > 0;
    if (hasMetadata) persistSessionMetadata(sessionManager, sessionMetadata);
    const record = {
      id: sessionID,
      directory: cwd,
      sessionFile: typeof sessionManager?.getSessionFile === 'function'
        ? sessionManager.getSessionFile()
        : (typeof piSession?.sessionFile === 'string' ? piSession.sessionFile : undefined),
      sessionManager,
      info: createSessionInfo({
        id: sessionID,
        directory: cwd,
        title,
        parentID: resolvedParentID || readPersistedParentID(sessionMetadata),
        metadata: hasMetadata ? sessionMetadata : undefined,
        projectID: cwd,
      }),
      messages: [],
      status: { type: 'idle' },
      piSession,
      translator: createRecordTranslator(sessionID, cwd, { piSession }),
      unsubscribe: null,
    };
    attachSession(record);
    await bindDesktopExtensionUI(record);
    sessions.set(sessionID, record);
    sessionTodos.set(sessionID, []);
    emit(cwd, {
      id: createSessionId().replace('ses_', 'evt_'),
      type: 'session.created',
      properties: { info: record.info },
    });
    return record;
  };

  const persistRecordMessages = (record) => {
    if (!record?.sessionManager) return;
    if ((record.messages || []).length === 0) return;
    if (!persistFacadeMessages(record.sessionManager, record.messages)) {
      const error = new Error('Cannot persist session messages');
      error.status = 500;
      throw error;
    }
  };

  const missingSession = (sessionID) => {
    const error = new Error(`Session not found: ${sessionID}`);
    error.status = 404;
    return error;
  };

  const getRecord = (sessionID) => {
    const record = sessions.get(sessionID);
    if (!record) {
      throw missingSession(sessionID);
    }
    return record;
  };

  const findPersistedSession = async (sessionID, directory) => {
    const seen = new Set();
    for (const cwd of [directory, defaultDirectory]) {
      if (!cwd || seen.has(cwd)) continue;
      seen.add(cwd);
      try {
        const listed = await listPersistedSessionItems(cwd, { includeArchived: true });
        const found = (listed || []).find((item) => item?.id === sessionID);
        if (found) return found;
      } catch {
      }
    }
    const file = findSessionFileById(sessionID, home);
    if (!file) return null;
    return { id: sessionID, path: file };
  };

  const hydratePersistedSession = async (sessionID, directory) => {
    const persisted = await findPersistedSession(sessionID, directory);
    const file = persisted?.path || findSessionFileById(sessionID, home);
    if (!file || !fs.existsSync(file)) {
      throw missingSession(sessionID);
    }
    const pi = await loadPiSdk();
    if (typeof pi.SessionManager?.open !== 'function') {
      throw missingSession(sessionID);
    }
    const manager = pi.SessionManager.open(file);
    const cwd = (typeof manager.getCwd === 'function' && manager.getCwd())
      || persisted?.cwd
      || directory
      || defaultDirectory;
    const factory = await resolveCreateSession();
    const model = await resolvePreferredModel();
    let piSession;
    try {
      piSession = await invokeSessionFactory(factory, {
        cwd,
        modelRuntime,
        model,
        sessionManager: manager,
      });
    } catch (error) {
      console.warn(`[pi-host] failed to attach live Pi session ${sessionID}:`, error?.message || error);
      piSession = createInMemoryPiSession({ sessionId: sessionID });
    }
    const title = resolveListedSessionTitle({
      name: (typeof manager.getSessionName === 'function' && manager.getSessionName())
        || persisted?.name,
      firstMessage: persisted?.firstMessage,
    });
    const entries = typeof manager.getEntries === 'function' ? manager.getEntries() : [];
    const created = persisted?.created ? new Date(persisted.created).getTime() : Date.now();
    const updated = persisted?.modified ? new Date(persisted.modified).getTime() : created;
    const metadata = readPersistedSessionMetadata(entries);
    const record = {
      id: sessionID,
      directory: cwd,
      sessionFile: file,
      sessionManager: manager,
      info: {
        ...createSessionInfo({
          id: sessionID,
          directory: cwd,
          title,
          parentID: readPersistedParentID(metadata),
          projectID: cwd,
          metadata,
        }),
        time: sessionTimeWithArchived({
          created: Number.isFinite(created) ? created : Date.now(),
          updated: Number.isFinite(updated) ? updated : Date.now(),
        }, metadata),
      },
      messages: hydrateFacadeMessages(entries, sessionID, { piSession }),
      status: { type: 'idle' },
      piSession,
      translator: createRecordTranslator(sessionID, cwd, { piSession }),
      unsubscribe: null,
    };
    attachSession(record);
    await bindDesktopExtensionUI(record);
    sessions.set(sessionID, record);
    publishRecordTodos(record, entries);
    return record;
  };

  const readRecordPlan = (record) => {
    if (typeof record?.piSession?.getPlanModeState === 'function') {
      return sessionPlanFromState(record.piSession.getPlanModeState());
    }
    const manager = record?.sessionManager;
    const entries = typeof manager?.getEntries === 'function'
      ? manager.getEntries()
      : (typeof manager?.getBranch === 'function' ? manager.getBranch() : []);
    return sessionPlanFromState(restoreSessionPlanState(entries));
  };

  const persistRecordPlanState = (record, next) => {
    if (typeof record?.piSession?.setPlanModeState === 'function') {
      record.piSession.setPlanModeState(next);
    }
    if (typeof record?.sessionManager?.appendCustomEntry === 'function') {
      record.sessionManager.appendCustomEntry(PLAN_MODE_STATE_ENTRY_TYPE, next);
    } else if (typeof record?.piSession?.appendEntry === 'function') {
      record.piSession.appendEntry(PLAN_MODE_STATE_ENTRY_TYPE, next);
    }
  };

  const emitPlanUpdated = (record, plan) => {
    emit(record.directory, {
      id: createEventId(),
      type: 'pi.plan.updated',
      properties: { sessionID: record.id, plan },
    });
  };

  const statSessionFile = (file) => {
    try {
      const stat = fs.statSync(file);
      return { mtimeMs: stat.mtimeMs, size: stat.size };
    } catch {
      return null;
    }
  };

  const sessionFileStampEquals = (left, right) => (
    Boolean(left)
    && Boolean(right)
    && left.mtimeMs === right.mtimeMs
    && left.size === right.size
  );

  const findRecordBySessionFile = (file) => {
    for (const record of sessions.values()) {
      if (record.sessionFile === file) return record;
    }
    return null;
  };

  const readSessionFileEntries = (file) => {
    try {
      return fs.readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  };

  const attachSessionFromFile = async (file, {
    sessionID,
    directory,
    parentID,
    metadata,
    title,
  } = {}) => {
    const resolvedFile = typeof file === 'string' ? file.trim() : '';
    if (!resolvedFile || !fs.existsSync(resolvedFile)) {
      throw missingSession(sessionID || resolvedFile);
    }
    const hintedId = (typeof sessionID === 'string' && sessionID.trim())
      ? sessionID.trim()
      : readSessionIdFromSessionFile(resolvedFile);
    const existing = (hintedId && sessions.get(hintedId)) || findRecordBySessionFile(resolvedFile);
    if (existing) {
      if (parentID) existing.info.parentID = parentID;
      if (metadata && typeof metadata === 'object') {
        existing.info.metadata = { ...(existing.info.metadata || {}), ...metadata };
      }
      return existing;
    }
    let manager = null;
    if (!mock) {
      try {
        const pi = await loadPiSdk();
        if (typeof pi.SessionManager?.open === 'function') {
          manager = pi.SessionManager.open(resolvedFile);
        }
      } catch {
        manager = null;
      }
    }
    const fileEntries = readSessionFileEntries(resolvedFile);
    const cwd = (typeof manager?.getCwd === 'function' && manager.getCwd())
      || directory
      || defaultDirectory;
    const resolvedId = (typeof manager?.getSessionId === 'function' && manager.getSessionId())
      || sessionID
      || readSessionIdFromSessionFile(resolvedFile);
    if (!resolvedId) {
      throw missingSession(sessionID || resolvedFile);
    }
    const alreadyAttached = sessions.get(resolvedId);
    if (alreadyAttached) {
      if (parentID) alreadyAttached.info.parentID = parentID;
      if (metadata && typeof metadata === 'object') {
        alreadyAttached.info.metadata = { ...(alreadyAttached.info.metadata || {}), ...metadata };
      }
      return alreadyAttached;
    }
    const factory = await resolveCreateSession();
    const model = await resolvePreferredModel();
    let piSession;
    try {
      piSession = await invokeSessionFactory(factory, {
        cwd,
        modelRuntime,
        model,
        ...(manager ? { sessionManager: manager } : {}),
      });
    } catch (error) {
      console.warn(`[pi-host] failed to attach subagent session ${resolvedId}:`, error?.message || error);
      piSession = createInMemoryPiSession({ sessionId: resolvedId });
    }
    const entries = typeof manager?.getEntries === 'function' ? manager.getEntries() : fileEntries;
    const persistedMetadata = readPersistedSessionMetadata(entries);
    const record = {
      id: resolvedId,
      directory: cwd,
      sessionFile: resolvedFile,
      sessionManager: manager,
      info: createSessionInfo({
        id: resolvedId,
        directory: cwd,
        title: title
          || (typeof manager?.getSessionName === 'function' && manager.getSessionName())
          || 'Subagent',
        parentID: parentID || readPersistedParentID(persistedMetadata),
        metadata: {
          ...(persistedMetadata || {}),
          ...(metadata || {}),
        },
        projectID: cwd,
      }),
      messages: hydrateFacadeMessages(entries, resolvedId, { piSession }),
      status: { type: 'idle' },
      sessionFileStamp: statSessionFile(resolvedFile),
      piSession,
      translator: createRecordTranslator(resolvedId, cwd, { piSession }),
      unsubscribe: null,
    };
    attachSession(record);
    sessions.set(resolvedId, record);
    publishRecordTodos(record, entries);
    emit(cwd, {
      id: createEventId(),
      type: 'session.created',
      properties: { info: record.info },
    });
    return record;
  };

  const refreshChildMessagesFromFile = (record) => {
    const file = record?.sessionFile;
    if (!file || !fs.existsSync(file)) return;
    const stamp = statSessionFile(file);
    if (stamp && sessionFileStampEquals(record.sessionFileStamp, stamp)) {
      return;
    }
    try {
      const piSessionManager = record.sessionManager;
      const entries = typeof piSessionManager?.getEntries === 'function'
        ? piSessionManager.getEntries()
        : readSessionFileEntries(file);
      if (!Array.isArray(entries)) return;
      record.messages = hydrateFacadeMessages(entries, record.id, record);
      record.sessionFileStamp = stamp;
    } catch {
    }
  };

  const collectSubagentRuns = (parent) => {
    const fileRuns = listAdapterRunsFromFiles({
      parent,
      projectDir: parent.directory,
    });
    const liveRuns = [
      ...extractRunsFromFacadeMessages(parent.messages, parent.id),
      ...extractRunsFromPiEntries(
        typeof parent.sessionManager?.getEntries === 'function' ? parent.sessionManager.getEntries() : [],
        parent.id,
      ),
    ];
    return reconcileParentSubagentRuns(fileRuns, liveRuns);
  };

  const attachSubagentRun = async (parent, run) => {
    const childId = run?.sessionID && run.sessionID !== parent.id ? run.sessionID : null;
    if (!run?.sessionFile && !childId) return run;
    try {
      if (run.sessionFile) {
        const record = await attachSessionFromFile(run.sessionFile, {
          sessionID: run.sessionID || undefined,
          directory: parent.directory,
          parentID: parent.id,
          title: run.title || run.name,
          metadata: {
            pichamber: {
              subagentRun: {
                runId: run.runId,
                parentSessionID: parent.id,
                mode: run.mode,
                state: run.state,
                name: run.name,
                role: run.role,
              },
            },
          },
        });
        record.subagentRun = run;
        const nextState = run.state === 'running' || run.state === 'queued' || run.state === 'blocked'
          ? { type: 'busy' }
          : { type: 'idle' };
        if (record.status?.type !== nextState.type) {
          record.status = nextState;
          emit(record.directory, {
            id: createEventId(),
            type: nextState.type === 'busy' ? 'session.status' : 'session.idle',
            properties: nextState.type === 'busy'
              ? { sessionID: record.id, status: nextState }
              : { sessionID: record.id },
          });
        }
        return { ...run, sessionID: record.id };
      }
      if (childId) {
        return { ...run, sessionID: childId };
      }
    } catch (error) {
      console.warn(`[pi-host] failed to attach subagent run ${run.runId}:`, error?.message || error);
    }
    return run;
  };

  const ensureRecord = async (sessionID, directory) => {
    const existing = sessions.get(sessionID);
    if (existing) return existing;
    if (mock) {
      throw missingSession(sessionID);
    }
    const pending = hydrating.get(sessionID);
    if (pending) return pending;
    const task = hydratePersistedSession(sessionID, directory).catch(async (error) => {
      const adapterRun = findAdapterRunByChildSessionId(sessionID, {
        projectDir: directory || defaultDirectory,
      });
      if (adapterRun?.sessionFile) {
        return attachSessionFromFile(adapterRun.sessionFile, {
          sessionID,
          directory: directory || defaultDirectory,
          parentID: adapterRun.parentID,
          title: adapterRun.title || adapterRun.name,
          metadata: {
            pichamber: {
              subagentRun: {
                runId: adapterRun.runId,
                parentSessionID: adapterRun.parentID,
                mode: adapterRun.mode,
                state: adapterRun.state,
                name: adapterRun.name,
                role: adapterRun.role,
              },
            },
          },
        });
      }
      throw error;
    }).finally(() => {
      hydrating.delete(sessionID);
    });
    hydrating.set(sessionID, task);
    return task;
  };

  const invalidateModelRuntime = () => {
    modelRuntime = null;
    modelRuntimeError = null;
    readyPromise = null;
  };

  const reloadLiveRecord = async (record) => {
    const blocked = sessionBlocksPiReload(record);
    if (blocked) {
      const error = new Error(blocked);
      error.status = 409;
      throw error;
    }
    record.unsubscribe?.();
    if (typeof record.piSession?.reload === 'function') {
      await record.piSession.reload();
      if (typeof record.piSession.setCustomTools === 'function') {
        record.piSession.setCustomTools(await resolveCustomTools());
      } else if (typeof getCustomTools === 'function') {
        try {
          record.extensionUI?.dispose?.();
          record.piSession?.dispose?.();
        } catch {
        }
        const factory = await resolveCreateSession();
        record.piSession = await invokeSessionFactory(factory, {
          cwd: record.directory,
          modelRuntime,
          sessionManager: record.sessionManager,
        });
      }
    } else {
      try {
        record.extensionUI?.dispose?.();
        record.piSession?.dispose?.();
      } catch {
      }
      const factory = await resolveCreateSession();
      record.piSession = await invokeSessionFactory(factory, {
        cwd: record.directory,
        modelRuntime,
      });
    }
    attachSession(record);
    await bindDesktopExtensionUI(record);
    try {
      syncRecordTodos(record);
    } catch {
      // Reload still succeeded. Keep the last good snapshot instead of [].
    }
    emit(record.directory, {
      id: createEventId(),
      type: 'session.updated',
      properties: { info: record.info },
    });
  };

  const readListMetadata = typeof readListSessionMetadata === 'function'
    ? readListSessionMetadata
    : readPersistedSessionMetadataFromFileTail;

  const toPersistedSessionInfo = (item, directory) => {
    const id = item?.id || item?.path;
    if (!id) return null;
    // Reuse title / firstMessage / timestamps from SessionManager.list().
    // Tail-scan only for the last pichamber.metadata (archived / parentID).
    const metadata = item.path ? readListMetadata(item.path) : undefined;
    const parentID = readPersistedParentID(metadata);
    return {
      id,
      projectID: item.cwd || directory || 'pi',
      directory: item.cwd || directory,
      title: resolveListedSessionTitle(item),
      version: 'pi',
      ...(parentID ? { parentID } : {}),
      time: sessionTimeWithArchived({
        created: item.created ? new Date(item.created).getTime() : Date.now(),
        updated: item.modified ? new Date(item.modified).getTime() : Date.now(),
      }, metadata),
    };
  };

  const collectSessionInfos = async (directory, query) => {
    const includeArchived = !query || includeArchivedSessions(query.archived);
    const live = Array.from(sessions.values())
      .filter((record) => !directory || record.directory === directory)
      .map((record) => record.info)
      .filter((info) => includeArchived || !info?.time?.archived);
    const seen = new Set(live.map((info) => info.id));
    if (mock) return live;
    try {
      const cwd = directory || defaultDirectory;
      const persisted = await listPersistedSessionItems(cwd, { includeArchived });
      for (const item of persisted || []) {
        try {
          const info = toPersistedSessionInfo(item, directory);
          if (!info || seen.has(info.id)) continue;
          relocateListedArchivedItem(item, info, directory);
          if (!includeArchived && info.time?.archived) continue;
          seen.add(info.id);
          live.push(info);
        } catch {
          // One unreadable session file does not drop other complete sessions.
        }
      }
    } catch {
      // Persisted listing failed: keep live sessions. Do not return empty success.
    }
    return live;
  };

  const refreshRecordMessagesFromDisk = async (record) => {
    const file = record?.sessionFile;
    if (!file || !fs.existsSync(file)) return false;
    try {
      const pi = await loadPiSdk();
      if (typeof pi.SessionManager?.open !== 'function') {
        refreshChildMessagesFromFile(record);
        return true;
      }
      const manager = pi.SessionManager.open(file);
      const entries = typeof manager.getEntries === 'function' ? manager.getEntries() : [];
      record.messages = hydrateFacadeMessages(entries, record.id, record);
      const title = typeof manager.getSessionName === 'function' && manager.getSessionName();
      if (title) record.info.title = title;
      const metadata = readPersistedSessionMetadata(entries);
      if (metadata) {
        record.info.metadata = { ...(record.info.metadata || {}), ...metadata };
      }
      const parentID = readPersistedParentID(metadata || record.info.metadata);
      if (parentID) record.info.parentID = parentID;
      let updated;
      try {
        const mtime = fs.statSync(file).mtimeMs;
        if (Number.isFinite(mtime)) updated = mtime;
      } catch {
        // Keep the previous updated stamp when the file disappears mid-refresh.
      }
      record.info.time = sessionTimeWithArchived({
        ...(record.info.time || {}),
        ...(Number.isFinite(updated) ? { updated } : {}),
      }, metadata || record.info.metadata);
      return true;
    } catch (error) {
      console.warn(`[pi-host] session record refresh failed for ${record.id}:`, error?.message || error);
      return false;
    }
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
    async ensureSession(sessionID, directory) {
      return ensureRecord(sessionID, directory);
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
    async deleteSession(sessionID, directory) {
      const record = await ensureRecord(sessionID, directory);
      try {
        record.extensionUI?.dispose?.();
        record.unsubscribe?.();
        record.piSession?.dispose?.();
      } catch {
      }
      sessions.delete(sessionID);
      sessionTodos.delete(sessionID);
      if (record.sessionFile) {
        try {
          fs.unlinkSync(record.sessionFile);
        } catch {
        }
      }
      emit(record.directory, {
        type: 'session.deleted',
        properties: { info: record.info, sessionID },
      });
      return true;
    },
    async updateSession(sessionID, patch = {}, directory) {
      const record = await ensureRecord(sessionID, directory);
      if (typeof patch.title === 'string') {
        record.info.title = patch.title;
        if (typeof record.sessionManager?.appendSessionInfo === 'function' && patch.title.trim()) {
          try {
            record.sessionManager.appendSessionInfo(patch.title);
          } catch {
          }
        }
      }
      if (patch.metadata && typeof patch.metadata === 'object') {
        record.info.metadata = { ...(record.info.metadata || {}), ...patch.metadata };
      }
      if (patch.time && Object.prototype.hasOwnProperty.call(patch.time, 'archived') && patch.time.archived !== null) {
        const archived = readPersistedArchivedTimestamp({ archived: patch.time.archived });
        if (archived !== undefined) {
          record.info.time = { ...record.info.time, archived };
          record.info.metadata = { ...(record.info.metadata || {}), archived };
        }
      }
      if (patch.metadata || (patch.time && Object.prototype.hasOwnProperty.call(patch.time, 'archived'))) {
        persistSessionMetadata(record.sessionManager, record.info.metadata);
      }
      if (patch.time && Object.prototype.hasOwnProperty.call(patch.time, 'archived') && patch.time.archived !== null) {
        const archived = readPersistedArchivedTimestamp({ archived: patch.time.archived });
        if (archived !== undefined && record.sessionFile) {
          const sessionDir = sessionDirForCwd(record.directory, home);
          const nextFile = relocateSessionFileForArchiveState(
            record.sessionFile,
            sessionDir,
            Boolean(archived),
          );
          retargetRecordSessionFile(record, nextFile);
        }
      }
      record.info.time.updated = Date.now();
      emit(record.directory, {
        type: 'session.updated',
        properties: { info: record.info },
      });
      return record;
    },
    getMessages(sessionID) {
      const record = getRecord(sessionID);
      if (record.subagentRun) {
        refreshChildMessagesFromFile(record);
      }
      return record.messages;
    },
    async listSubagentRuns(sessionID, directory) {
      if (!isSubagentsSlotActive(this.getFeaturePlugins())) {
        return { runs: [] };
      }
      const parent = await ensureRecord(sessionID, directory);
      const runs = [];
      for (const run of collectSubagentRuns(parent)) {
        runs.push(toPublicSubagentRun(await attachSubagentRun(parent, run)));
      }
      return { runs };
    },
    async listSessionChildren(sessionID, directory) {
      if (!isSubagentsSlotActive(this.getFeaturePlugins())) {
        return [];
      }
      const { runs } = await this.listSubagentRuns(sessionID, directory);
      return runs
        .filter((run) => run.sessionID)
        .map((run) => sessions.get(run.sessionID)?.info)
        .filter(Boolean);
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
      const agentDir = resolveAgentDir();
      return {
        home,
        directory: cwd,
        worktree: cwd,
        state: agentDir,
        config: agentDir,
      };
    },
    listSkills(directory) {
      return listPiSkills({ home, directory: directory || defaultDirectory });
    },
    listPrompts(directory) {
      return listPiPrompts({ home, directory: directory || defaultDirectory });
    },
    async ensureSession(sessionID, directory) {
      return ensureRecord(sessionID, directory);
    },
    listCommands(directory, options = {}) {
      const cwd = directory || defaultDirectory;
      const listed = listPiCommands({ home, directory: cwd });
      const sessionID = typeof options.sessionID === 'string' ? options.sessionID.trim() : '';
      const live = [];
      for (const record of sessions.values()) {
        if (sessionID && record.id !== sessionID) continue;
        if (!sessionID && record.directory !== cwd) continue;
        live.push(...readLiveSessionCommands(record.piSession));
      }
      return mergeLiveExtensionCommands(
        mergeLiveExtensionCommands(listed, live),
        listFeaturePluginSlashCommands(this.getFeaturePlugins()),
      );
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
    invalidateModelRuntime,
    setProviderAuth(providerId, body) {
      const result = writePiProviderAuth(providerId, body, { home });
      invalidateModelRuntime();
      return result;
    },
    removeProviderAuth(providerId) {
      const result = removePiProviderAuth(providerId, { home });
      invalidateModelRuntime();
      return result;
    },
    upsertProvider(providerId, config, options = {}) {
      const result = upsertPiProviderConfig({
        home,
        directory: options.directory || defaultDirectory,
        providerId,
        config,
        scope: options.scope,
        hasStoredAuth: options.hasStoredAuth,
      });
      invalidateModelRuntime();
      return result;
    },
    deleteProvider(providerId, options = {}) {
      const result = deletePiProviderConfig({
        home,
        directory: options.directory || defaultDirectory,
        providerId,
        scope: options.scope,
      });
      invalidateModelRuntime();
      return result;
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
          agent: resolveAgentDir(),
          models: resolvePiModelsPath(home),
          skills: path.join(resolveAgentDir(), 'skills'),
          prompts: path.join(resolveAgentDir(), 'prompts'),
        },
      };
    },
    getConfigSkills(directory) {
      const cwd = directory || defaultDirectory;
      return toConfigSkillsPayload(this.listSkills(cwd), { home, directory: cwd });
    },
    getSkillDetail(directory, name) {
      return getPiSkillDetail({ home, directory: directory || defaultDirectory, name });
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
        const providers = mapPiModelsToProviders(available, {
          configs: listPiProviderPublicConfigs({ home, directory: defaultDirectory }),
        });
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
      const record = await ensureRecord(sessionID);
      const modelRef = resolvePromptModelRef(body.model);
      if (modelRef) {
        await this.setSessionModel(sessionID, modelRef);
      }
      const requestedThinking = typeof body.variant === 'string' ? body.variant.trim()
        : typeof body.thinking === 'string' ? body.thinking.trim()
        : '';
      if (requestedThinking && THINKING_LEVELS.includes(requestedThinking)) {
        try {
          await this.setSessionThinking(sessionID, requestedThinking);
        } catch {
          // Keep the session's current thinking when the pin is unsupported.
        }
      }
      const text = extractPromptText(body.parts) || (typeof body.text === 'string' ? body.text : '');
      if (!text) {
        const error = new Error('Message must have at least one text part');
        error.status = 400;
        throw error;
      }

      const userMessageID = body.messageID || createMessageId();
      const userAgent = typeof body.agent === 'string' && body.agent.trim() ? body.agent : 'pi';
      const runtimeModel = resolveHostFallbackModel(record, body.model);
      if (runtimeModel) {
        record.translator.setFallbackModel(runtimeModel);
      }
      record.translator.setUserMessage(userMessageID, {
        agent: userAgent,
        model: runtimeModel || body.model,
      });
      const userParts = [{
        id: createPartId(),
        sessionID,
        messageID: userMessageID,
        type: 'text',
        text,
      }];
      for (const part of Array.isArray(body.parts) ? body.parts : []) {
        if (!part || part.type === 'text') continue;
        const file = facadeFilePartFromUnknown(part, sessionID, userMessageID);
        if (file) userParts.push(file);
      }
      const userInfo = {
        id: userMessageID,
        sessionID,
        role: 'user',
        time: { created: Date.now() },
        agent: userAgent,
        ...(body.model ? { model: body.model } : {}),
      };
      record.messages.push({ info: userInfo, parts: userParts });
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
      for (const part of userParts) {
        emit(record.directory, {
          id: createEventId(),
          type: 'message.part.updated',
          properties: { sessionID, part, time: Date.now() },
        });
      }

      const images = extractPromptImages(body.parts);
      const promptOptions = {
        ...(images.length > 0 ? { images } : {}),
      };

      const isStreaming = Boolean(record.piSession.isStreaming);
      const delivery = body.delivery;
      const run = async () => {
        try {
          ensureQuestionToolAdapted(record);
          if (isStreaming && delivery === 'steer' && typeof record.piSession.steer === 'function') {
            await record.piSession.steer(text, images);
            return;
          }
          if (isStreaming && (delivery === 'followUp' || delivery === 'follow_up') && typeof record.piSession.followUp === 'function') {
            await record.piSession.followUp(text, images);
            return;
          }
          if (isStreaming && typeof record.piSession.steer === 'function') {
            await record.piSession.steer(text, images);
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
        } finally {
          settleRecordIfStuck(record);
        }
      };

      void run();
      return { info: userInfo, parts: userParts };
    },
    async abort(sessionID) {
      const record = await ensureRecord(sessionID);
      try {
        record.extensionUI?.cancelAll?.();
      } catch {
      }
      try {
        await record.piSession.abort();
      } catch {
      }
      // Pi abort is a no-op when the kernel is no longer streaming. Always
      // publish idle so Stop cannot stay armed after a finished or hung turn.
      forceSettleRecord(record);
      return true;
    },
    async cloneSession(sessionID) {
      const source = await ensureRecord(sessionID);
      const record = await createFacadeSession({
        directory: source.directory,
        title: source.info.title ? `${source.info.title} (copy)` : 'Cloned session',
        parentID: source.id,
      });
      record.messages = cloneImportedMessages(source.messages, record.id);
      persistRecordMessages(record);
      record.info.time.updated = Date.now();
      return record;
    },
    async listPersistedSessions(directory) {
      if (mock) return [];
      try {
        const cwd = directory || defaultDirectory;
        return await listPersistedSessionItems(cwd, { includeArchived: false });
      } catch {
        return [];
      }
    },
    async listSessionInfos(directory, query) {
      return collectSessionInfos(directory, query);
    },
    async reload(options) {
      const target = typeof options === 'string'
        ? { directory: options }
        : (options && typeof options === 'object' ? options : {});
      const sessionID = typeof target.sessionID === 'string' ? target.sessionID.trim() : '';
      const directory = typeof target.directory === 'string' ? target.directory : undefined;

      if (sessionID) {
        const record = await ensureRecord(sessionID, directory);
        await reloadLiveRecord(record);
        const skills = listPiSkills({ home, directory: record.directory });
        const commands = listPiCommands({ home, directory: record.directory });
        return {
          reloaded: true,
          kernel: 'pi',
          sessionID: record.id,
          skills: skills.length,
          commands: commands.length,
        };
      }

      const processWideTargets = [];
      for (const record of sessions.values()) {
        if (directory && record.directory !== directory) continue;
        processWideTargets.push(record);
      }
      for (const record of processWideTargets) {
        if (record?.piSession?.isCompacting) {
          const error = new Error(RELOAD_WAIT_FOR_COMPACTION);
          error.status = 409;
          throw error;
        }
      }
      const interruptedRecords = processWideTargets.filter((record) => sessionBlocksPiReload(record));
      for (const record of interruptedRecords) {
        await interruptRecordForKernelReload(record);
      }
      if (interruptedRecords.length > 0) {
        emit(interruptedRecords[0].directory || 'global', {
          id: createEventId(),
          type: 'openchamber:notification',
          properties: buildKernelReloadInterruptedNotification(interruptedRecords),
        });
      }

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

      try {
        await ensureModelRuntime();
      } catch {
      }

      for (const record of sessions.values()) {
        if (directory && record.directory !== directory) continue;
        try {
          await reloadLiveRecord(record);
        } catch (error) {
          console.warn(`[pi-host] reload failed for session ${record.id}:`, error?.message || error);
        }
      }

      await ready();

      const cwd = directory || defaultDirectory;
      const skills = listPiSkills({ home, directory: cwd });
      const commands = listPiCommands({ home, directory: cwd });
      // In-place TUI-style reload: refresh skills/prompts/extensions only.
      // Do not emit server.connected — the UI treats that as a full re-bootstrap
      // and would drop the open session onto a new-session draft.

      return {
        reloaded: true,
        kernel: 'pi',
        sessions: sessions.size,
        skills: skills.length,
        commands: commands.length,
        interruptedSessionIds: interruptedRecords.map((record) => record.id),
      };
    },
    async reloadSessionRecords(options = {}) {
      const target = options && typeof options === 'object' ? options : {};
      const sessionID = typeof target.sessionID === 'string' ? target.sessionID.trim() : '';
      const directory = typeof target.directory === 'string' ? target.directory : undefined;

      let targeted = null;
      if (sessionID) {
        targeted = await ensureRecord(sessionID, directory);
        const blocked = sessionBlocksPiReload(targeted);
        if (blocked) {
          const error = new Error(blocked);
          error.status = 409;
          throw error;
        }
      }

      const anyBusy = Array.from(sessions.values()).some((record) => (
        (!directory || record.directory === directory) && sessionBlocksPiReload(record)
      ));
      if (!anyBusy) {
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
        try {
          await ensureModelRuntime();
        } catch {
        }
      }

      const liveReloaded = [];
      const skipped = [];
      const failed = [];
      for (const record of sessions.values()) {
        if (directory && record.directory !== directory) continue;
        const blocked = sessionBlocksPiReload(record);
        if (blocked) {
          skipped.push({ sessionID: record.id, reason: blocked });
          continue;
        }
        try {
          await reloadLiveRecord(record);
          liveReloaded.push(record.id);
        } catch (error) {
          failed.push({
            sessionID: record.id,
            reason: error?.message || 'reload failed',
          });
          console.warn(`[pi-host] session-records reload failed for ${record.id}:`, error?.message || error);
        }
      }

      if (targeted) {
        const refreshed = await refreshRecordMessagesFromDisk(targeted);
        if (!refreshed && targeted.sessionFile) {
          failed.push({
            sessionID: targeted.id,
            reason: 'session record refresh failed',
          });
        }
      }

      if (!anyBusy) {
        try {
          await ready();
        } catch {
        }
      }

      const cwd = directory || targeted?.directory || defaultDirectory;
      const listed = await collectSessionInfos(directory || targeted?.directory, { archived: false });
      const skills = listPiSkills({ home, directory: cwd });
      const commands = listPiCommands({ home, directory: cwd });
      // Refresh skills/prompts/extensions and re-read persisted session records.
      // Do not emit server.connected — the UI treats that as a full re-bootstrap
      // and would drop the open session onto a new-session draft.

      return {
        reloaded: true,
        kernel: 'pi',
        sessionID: targeted?.id,
        sessions: listed,
        messages: targeted ? targeted.messages : [],
        skills: skills.length,
        commands: commands.length,
        liveReloaded,
        skipped,
        failed,
      };
    },
    async runCommand(sessionID, body = {}) {
      const record = await ensureRecord(sessionID);
      const rawName = typeof body.command === 'string' ? body.command : '';
      const name = rawName.replace(/^\//, '').trim();
      const argument = typeof body.arguments === 'string' ? body.arguments.trim() : '';
      const userText = `/${[name, argument].filter(Boolean).join(' ')}`;

      if (!name) {
        const error = new Error('Command name is required');
        error.status = 400;
        throw error;
      }

      const reply = async (assistantText) => completeLocalReply(record, body, userText, assistantText);

      const dispatchLiveSessionCommand = async () => {
        if (typeof record.piSession?.prompt !== 'function') {
          const error = new Error(`Command /${name} is not available on this session`);
          error.status = 500;
          throw error;
        }
        ensureQuestionToolAdapted(record);
        await record.piSession.prompt(userText);
        if (name === 'plan') {
          emitPlanUpdated(record, readRecordPlan(record));
        }
        settleRecordIfStuck(record);
        const assistantID = createMessageId();
        return {
          info: {
            id: assistantID,
            sessionID: record.id,
            role: 'assistant',
            time: { created: Date.now(), completed: Date.now() },
            agent: 'pi',
            finish: 'stop',
          },
          parts: [],
        };
      };

      if (name === 'reload') {
        const error = new Error('reload is not a user command');
        error.status = 400;
        throw error;
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

      const goalCommand = readFeaturePlugins(home).goal?.command || 'goal';
      if (name === goalCommand) {
        if (!argument) {
          const error = new Error(
            `/${name} requires an objective. Bare /${name} is the TUI manager and is not supported on Desktop.`,
          );
          error.status = 400;
          throw error;
        }
        const liveGoal = findLiveSessionCommand(record.piSession, name);
        if (!liveGoal || !isExtensionCommandSource(liveGoal.source)) {
          const error = new Error(`Command /${name} is not available on this session`);
          error.status = 404;
          throw error;
        }
        return dispatchLiveSessionCommand();
      }

      if (name === 'run') {
        if (!isSubagentsSlotActive(this.getFeaturePlugins())) {
          const error = new Error('Command /run is not available on this session');
          error.status = 404;
          throw error;
        }
        if (!argument) {
          return reply(
            '/run needs an agent and a task, for example `/run scout Inspect the README`. Bare /run is the TUI launcher and is not supported on Desktop.',
          );
        }
        const liveRun = findLiveSessionCommand(record.piSession, name);
        if (!liveRun || !isExtensionCommandSource(liveRun.source)) {
          const error = new Error('Command /run is not available on this session');
          error.status = 404;
          throw error;
        }
        record.status = { type: 'busy' };
        emit(record.directory, {
          id: createEventId(),
          type: 'session.status',
          properties: { sessionID: record.id, status: { type: 'busy' } },
        });
        const findOpenableChild = async () => {
          const { runs } = await this.listSubagentRuns(record.id);
          return (runs || []).find((run) => (
            typeof run.sessionID === 'string'
            && run.sessionID
            && run.sessionID !== record.id
          ));
        };
        const missingChildReply = () => completeLocalReply(
          record,
          body,
          userText,
          'Could not start a subagent run. Check that Subagents is installed and enabled, then retry `/run <agent> <task>`.',
        );
        // Do not wait for the whole scout turn. Poll for an openable child
        // while prompt is in flight so a hung createHook still gets a Work
        // Status row, or an error instead of a silent parent hang.
        const waitMs = mock ? 400 : 12_000;
        const finishRun = async () => {
          const promptTask = Promise.resolve()
            .then(() => {
              ensureQuestionToolAdapted(record);
              return record.piSession.prompt(userText);
            })
            .then(() => 'done');
          const started = Date.now();
          try {
            while (true) {
              const child = await findOpenableChild();
              if (child) {
                forceSettleRecord(record);
                return;
              }
              const remaining = waitMs - (Date.now() - started);
              if (remaining <= 0) {
                missingChildReply();
                try {
                  await record.piSession.abort();
                } catch {
                }
                return;
              }
              const outcome = await Promise.race([
                promptTask,
                sleep(Math.min(50, remaining)).then(() => 'wait'),
              ]);
              if (outcome === 'done') {
                if (!await findOpenableChild()) missingChildReply();
                return;
              }
            }
          } catch (error) {
            completeLocalReply(
              record,
              body,
              userText,
              error?.message || 'Could not start a subagent run.',
            );
          } finally {
            settleRecordIfStuck(record);
          }
        };
        void finishRun();
        const assistantID = createMessageId();
        return {
          info: {
            id: assistantID,
            sessionID: record.id,
            role: 'assistant',
            time: { created: Date.now(), completed: Date.now() },
            agent: 'pi',
            finish: 'stop',
          },
          parts: [],
        };
      }

      const liveCommand = findLiveSessionCommand(record.piSession, name);
      if (liveCommand && isExtensionCommandSource(liveCommand.source)) {
        return dispatchLiveSessionCommand();
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

      if (liveCommand) {
        return dispatchLiveSessionCommand();
      }

      const error = new Error(`Unknown command: /${name}`);
      error.status = 404;
      throw error;
    },
    async getSessionPlan(sessionID) {
      const record = await ensureRecord(sessionID);
      return readRecordPlan(record);
    },
    async runPlanAction(sessionID, body = {}) {
      const record = await ensureRecord(sessionID);
      const { action, model } = parseSessionPlanAction(body);
      const blocked = sessionBlocksPiReload(record);
      if (blocked) {
        const error = new Error(blocked);
        error.status = 409;
        throw error;
      }

      if (action === 'resume') {
        const current = typeof record.piSession?.getPlanModeState === 'function'
          ? record.piSession.getPlanModeState()
          : restoreSessionPlanState(
            typeof record.sessionManager?.getEntries === 'function'
              ? record.sessionManager.getEntries()
              : [],
          );
        const next = resumeSavedPlanState(current);
        if (!next) {
          const error = new Error('No saved plan to resume');
          error.status = 409;
          throw error;
        }
        persistRecordPlanState(record, next);
        await this.reload({ sessionID: record.id });
        const reloaded = await ensureRecord(record.id);
        const plan = readRecordPlan(reloaded);
        emitPlanUpdated(reloaded, plan);
        return plan;
      }

      if (action === 'implement' && model) {
        await this.setSessionModel(sessionID, model);
      }

      await this.runCommand(sessionID, {
        command: 'plan',
        arguments: action === 'exit' ? 'exit' : action,
      });
      const plan = readRecordPlan(record);
      emitPlanUpdated(record, plan);
      return plan;
    },
    listExtensions(directory) {
      return listPiExtensions({ home, directory: directory || defaultDirectory });
    },
    listPackages(directory) {
      return listPiPackages({ home, directory: directory || defaultDirectory });
    },
    async listPackagesWithVersions(directory, options = {}) {
      const env = options.env || (mock
        ? { ...process.env, PI_SKIP_VERSION_CHECK: '1' }
        : process.env);
      return enrichPiPackageVersions(this.listPackages(directory), {
        home,
        directory: directory || defaultDirectory,
        env,
        fetchImpl: options.fetchImpl,
      });
    },
    async upgradePi(options = {}) {
      const updated = await selfUpdate({
        agentDir: resolveAgentDir(),
        env: options.env,
        spawnImpl: options.spawnImpl,
        resolveInvocation: options.resolveInvocation,
      });
      invalidatePiUpgradeStatusCache();
      let reload = null;
      try {
        reload = await this.reload();
      } catch (error) {
        reload = {
          error: error?.message || 'reload failed',
          status: Number(error?.status) || 500,
        };
      }
      return {
        success: true,
        command: updated.command,
        ...await getPiUpgradeStatus({
          env: options.env,
          fetchImpl: options.fetchImpl,
        }),
        reload,
      };
    },
    async updatePiPackages({ source, directory, env, fetchImpl } = {}) {
      const manager = await this.resolveFeaturePackageManager();
      if (typeof manager.update !== 'function') {
        const error = new Error('Pi package update is unavailable');
        error.status = 503;
        throw error;
      }
      const spec = typeof source === 'string' ? source.trim() : '';
      await manager.update(spec || undefined);
      const cwd = directory || defaultDirectory;
      const reload = await this.reloadIdleSessions(cwd);
      return {
        extensions: this.listExtensions(cwd),
        packages: await this.listPackagesWithVersions(cwd, { env, fetchImpl }),
        reload,
      };
    },
    async removePiPackage({ source, directory, env, fetchImpl } = {}) {
      const spec = typeof source === 'string' ? source.trim() : '';
      if (!spec) {
        const error = new Error('Package source is required');
        error.status = 400;
        throw error;
      }
      const manager = await this.resolveFeaturePackageManager();
      if (typeof manager.removeAndPersist !== 'function') {
        const error = new Error('Pi package uninstall is unavailable');
        error.status = 503;
        throw error;
      }
      const removed = await manager.removeAndPersist(spec);
      if (removed === false) {
        const error = new Error(`No matching package: ${spec}`);
        error.status = 404;
        throw error;
      }
      const cwd = directory || defaultDirectory;
      const reload = await this.reloadIdleSessions(cwd);
      return {
        extensions: this.listExtensions(cwd),
        packages: await this.listPackagesWithVersions(cwd, { env, fetchImpl }),
        reload,
      };
    },
    async resolveFeaturePackageManager() {
      if (typeof createPackageManager === 'function') {
        return createPackageManager({
          cwd: defaultDirectory,
          home,
          agentDir: resolveAgentDir(),
        });
      }
      if (mock) {
        return createSettingsJsonPackageManager({ home });
      }
      return createSdkPackageManager({
        cwd: defaultDirectory,
        home,
        loadSdk: loadPiSdk,
      });
    },
    getFeaturePlugins() {
      return toFeaturePluginsPayload({
        plugins: readFeaturePlugins(home),
        configuredSources: listConfiguredPiPackageSources(home),
      });
    },
    setFeaturePlugins(patch) {
      writeFeaturePlugins(home, patch);
      return this.getFeaturePlugins();
    },
    isMcpFeaturePluginActive() {
      return isMcpFeaturePluginActive(home);
    },
    listPiMcpConfigs(directory) {
      return listAdapterMcpConfigs({ home, cwd: directory || defaultDirectory });
    },
    getPiMcpStatus(directory) {
      if (!isMcpFeaturePluginActive(home)) {
        return {};
      }
      const cwd = directory || defaultDirectory;
      const snapshot = getRememberedMcpStatusSnapshot(cwd);
      if (snapshot) {
        return statusMapFromAdapterSnapshot(snapshot);
      }
      return statusMapFromAdapterConfigs(listAdapterMcpConfigs({ home, cwd }));
    },
    async mutatePiMcpConfig(action, name, directory, payload = {}) {
      if (!isMcpFeaturePluginActive(home)) {
        const error = new Error('MCP adapter is not installed and enabled');
        error.status = 404;
        error.unavailable = true;
        throw error;
      }
      const cwd = directory || defaultDirectory;
      if (action === 'create') {
        createAdapterMcpConfig({
          home,
          cwd,
          name,
          scope: payload.scope,
          config: payload,
        });
      } else if (action === 'update') {
        updateAdapterMcpConfig({ home, cwd, name, updates: payload });
      } else if (action === 'delete') {
        deleteAdapterMcpConfig({ home, cwd, name });
      } else {
        const error = new Error(`Unknown MCP mutation: ${action}`);
        error.status = 400;
        throw error;
      }
      const reload = await this.reloadIdleSessions(cwd);
      return {
        success: true,
        kernel: 'pi',
        reloaded: true,
        reload,
      };
    },
    async setPiMcpEnabled(name, enabled, directory) {
      if (!isMcpFeaturePluginActive(home)) {
        const error = new Error('MCP adapter is not installed and enabled');
        error.status = 404;
        error.unavailable = true;
        throw error;
      }
      const cwd = directory || defaultDirectory;
      setAdapterMcpEnabled({ home, cwd, name, enabled });
      const reload = await this.reloadIdleSessions(cwd);
      return {
        success: true,
        kernel: 'pi',
        reloaded: true,
        reload,
      };
    },
    async startPiMcpAuth(name, directory) {
      if (!isMcpFeaturePluginActive(home)) {
        const error = new Error('MCP adapter is not installed and enabled');
        error.status = 404;
        error.unavailable = true;
        throw error;
      }
      const cwd = directory || defaultDirectory;
      const config = getAdapterMcpConfig({ home, cwd, name });
      if (!config) {
        const error = new Error(`MCP server "${name}" not found`);
        error.status = 404;
        throw error;
      }
      const record = Array.from(sessions.values()).find((item) => item.directory === cwd);
      if (!record) {
        const error = new Error('No live session is available to authorize this MCP server');
        error.status = 409;
        throw error;
      }
      if (typeof this.runCommand !== 'function') {
        const error = new Error('MCP authorization is unavailable');
        error.status = 503;
        throw error;
      }
      await this.runCommand(record.id, { command: 'mcp-auth', arguments: name });
      return {
        success: true,
        kernel: 'pi',
        nativeFlow: true,
        sessionID: record.id,
      };
    },
    async applyFeaturePluginPatch(patch) {
      return this.setFeaturePlugins(patch);
    },
    async reloadIdleSessions(directory) {
      const reloaded = [];
      const skipped = [];
      for (const record of sessions.values()) {
        if (directory && record.directory !== directory) continue;
        const blocked = sessionBlocksPiReload(record);
        if (blocked) {
          skipped.push({ sessionID: record.id, reason: blocked });
          continue;
        }
        try {
          await this.reload({ sessionID: record.id });
          reloaded.push(record.id);
        } catch (error) {
          skipped.push({
            sessionID: record.id,
            reason: error?.message || 'reload failed',
          });
        }
      }
      return { reloaded, skipped, kernel: 'pi' };
    },
    async installFeaturePlugin(slot, body = {}) {
      if (!isFeaturePluginSlot(slot)) {
        const error = new Error('Unknown feature plugin slot');
        error.status = 400;
        throw error;
      }
      const current = readFeaturePlugins(home);
      const source = typeof body.source === 'string' && body.source.trim()
        ? body.source.trim()
        : current[slot].source;
      if (!source) {
        const error = new Error('Package source is required');
        error.status = 400;
        throw error;
      }
      const manager = await this.resolveFeaturePackageManager();
      await manager.installAndPersist(source);
      const next = writeFeaturePlugins(home, { [slot]: { source } });
      const reload = await this.reloadIdleSessions();
      return {
        ...toFeaturePluginsPayload({
          plugins: next,
          configuredSources: listConfiguredPiPackageSources(home),
        }),
        reload,
      };
    },
    async uninstallFeaturePlugin(slot, body = {}) {
      if (!isFeaturePluginSlot(slot)) {
        const error = new Error('Unknown feature plugin slot');
        error.status = 400;
        throw error;
      }
      const current = readFeaturePlugins(home);
      const source = typeof body.source === 'string' && body.source.trim()
        ? body.source.trim()
        : current[slot].source;
      if (!source) {
        const error = new Error('Package source is required');
        error.status = 400;
        throw error;
      }
      const manager = await this.resolveFeaturePackageManager();
      await manager.removeAndPersist(source);
      const reload = await this.reloadIdleSessions();
      return {
        ...toFeaturePluginsPayload({
          plugins: readFeaturePlugins(home),
          configuredSources: listConfiguredPiPackageSources(home),
        }),
        reload,
      };
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
      const source = await ensureRecord(sessionID);
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
      record.messages = cloneImportedMessages(messages, record.id);
      persistRecordMessages(record);
      record.info.time.updated = Date.now();
      return record;
    },
    getSessionThinking(sessionID) {
      const record = sessions.get(sessionID);
      if (!record) {
        const error = new Error('Session not found');
        error.status = 404;
        throw error;
      }
      return readSessionThinking(record.piSession);
    },
    async setSessionThinking(sessionID, level) {
      const record = await ensureRecord(sessionID);
      if (typeof record.piSession?.setThinkingLevel !== "function") {
        return { applied: false, ...readSessionThinking(record.piSession), thinking: level };
      }
      const snapshot = readSessionThinking(record.piSession);
      let next = THINKING_LEVELS.includes(level) ? level : null;
      if (snapshot.available.length > 0) {
        if (!next || !snapshot.available.includes(next)) {
          next = snapshot.available.includes("medium") ? "medium" : snapshot.available[0];
        }
      }
      if (!next) {
        const error = new Error("Invalid thinking level");
        error.status = 400;
        throw error;
      }
      record.piSession.setThinkingLevel(next);
      return { applied: true, thinking: next, available: snapshot.available };
    },
    async setSessionModel(sessionID, modelRef) {
      const record = await ensureRecord(sessionID);
      if (typeof record.piSession?.setModel !== "function") {
        return { applied: false, model: modelRef };
      }
      const raw = typeof modelRef === "string" ? modelRef.trim() : "";
      if (mock) {
        const [providerID, modelID] = raw.split("/");
        record.piSession.setModel({
          id: modelID || raw,
          ...(providerID ? { provider: providerID } : {}),
        });
        record.translator?.setFallbackModel?.(record.piSession.currentModel);
        return { applied: true, model: raw };
      }
      const runtime = await ensureModelRuntime();
      if (!runtime || typeof runtime.getAvailable !== "function") {
        const error = new Error("Pi models are not available");
        error.status = 400;
        throw error;
      }
      const available = await runtime.getAvailable();
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
      record.translator?.setFallbackModel?.(model);
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
      try {
        syncRecordTodos(record);
      } catch {
        // Compact still succeeded. Keep the last good snapshot instead of [].
      }
      return { compacted: true };
    },
    async getSessionTodos(sessionID, directory) {
      if (!isTodoSlotActive(this.getFeaturePlugins())) {
        return [];
      }
      const record = await ensureRecord(sessionID, directory);
      if (sessionTodos.has(record.id)) {
        return sessionTodos.get(record.id);
      }
      return syncRecordTodos(record);
    },
    exportSession(sessionID, format = 'jsonl', options = {}) {
      const record = getRecord(sessionID);
      const fmt = format === 'html' ? 'html' : 'jsonl';
      const basename = sanitizeExportBasename(record.info?.title);
      if (fmt === 'html') {
        return {
          format: 'html',
          filename: `${basename}.html`,
          mime: 'text/html; charset=utf-8',
          content: buildSessionHtml(record, options),
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
      persistRecordMessages(record);
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
    getExtensionUI,
    listExtensionUIPrompts(sessionID) {
      if (sessionID) {
        return getExtensionUI(sessionID)?.list() || [];
      }
      const prompts = [];
      for (const record of sessions.values()) {
        const items = record.extensionUI?.list?.() || [];
        prompts.push(...items);
      }
      return prompts;
    },
    replyExtensionUI(sessionID, promptID, value) {
      const ui = getExtensionUI(sessionID);
      if (!ui) {
        const error = new Error(`No Desktop ctx.ui is bound for session ${sessionID}`);
        error.status = 404;
        throw error;
      }
      if (!ui.reply(promptID, value)) {
        const error = new Error(`Extension UI prompt not found: ${promptID}`);
        error.status = 404;
        throw error;
      }
      return true;
    },
    cancelExtensionUI(sessionID, promptID) {
      const ui = getExtensionUI(sessionID);
      if (!ui) {
        const error = new Error(`No Desktop ctx.ui is bound for session ${sessionID}`);
        error.status = 404;
        throw error;
      }
      if (!ui.cancel(promptID)) {
        const error = new Error(`Extension UI prompt not found: ${promptID}`);
        error.status = 404;
        throw error;
      }
      return true;
    },
    dispose() {
      for (const record of sessions.values()) {
        try {
          record.extensionUI?.dispose?.();
          record.unsubscribe?.();
          record.piSession?.dispose?.();
        } catch {
        }
      }
      sessions.clear();
      sessionTodos.clear();
    },
  };
};
