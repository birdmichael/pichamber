import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { enrichKnownModelEntry } from './known-model-capabilities.js';
import { createEventId, createMessageId, createPartId, createSessionId } from './ids.js';
import { createEventTranslator, extractPromptImages, extractPromptText } from './event-translator.js';
import { directoriesMatch } from './directory-identity.js';
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
  resolvePiBuiltinCatalogIds,
  withoutUnconnectedBuiltinCatalogProviders,
  upsertPiProviderConfig,
  deletePiProviderConfig,
  writePiProviderAuth,
  removePiProviderAuth,
  resolvePiAgentDir,
  resolvePiAuthPath,
  resolvePiModelsPath,
} from './pi-resources.js';
import {
  authorizePiXaiOAuth,
  completePiXaiOAuth,
} from './xai-oauth.js';
import {
  getPiXaiUsage,
  isXaiSlotActive,
} from './xai-usage.js';
import {
  createSdkPackageManager,
  createSettingsJsonPackageManager,
  DEFAULT_FEATURE_PLUGIN_SOURCES,
  isFeaturePluginSlot,
  listConfiguredPiPackageSources,
  XAI_CONFLICTING_OAUTH_SOURCE,
  listFeaturePluginSlashCommands,
  listPiPackages,
  readFeaturePlugins,
  toFeaturePluginsPayload,
  writeFeaturePlugins,
} from './feature-plugins.js';
import { enrichPiPackageVersions } from './pi-package-versions.js';
import { getPiUpgradeStatus, invalidatePiUpgradeStatusCache } from './pi-upgrade-status.js';
import { createPiUpgradeUnsupportedError, runPiSelfUpdate } from './pi-upgrade.js';
import {
  collectSkippedUserExtensionsFromErrors,
  createUserExtensionNativeSkipStore,
  isElectronProcess,
  rememberSkippedUserExtensions,
  withUserExtensionNativeGuard,
} from './user-extension-native.js';
import {
  createElectronTreeLoadHelpers,
  syncUserExtensionElectronTree,
  wrapPackageManagerWithElectronNativeTree,
} from './user-extension-electron-tree.js';
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
  PICHAMBER_METADATA_CUSTOM_TYPE,
  persistSessionMetadata,
  readListedParentID,
  readPersistedArchivedTimestamp,
  readPersistedParentID,
  isTopLevelUserSessionFile,
  readPersistedSessionMetadata,
  readPersistedSessionMetadataFromFileTail,
  sessionTimeWithArchived,
} from './session-metadata.js';
import {
  findSessionJsonlById,
  isUnderSessionArchiveDir,
  readSessionIdFromJsonlHeader,
  relocateSessionFileForArchiveState,
  sessionArchiveDir,
  walkSessionJsonlFiles,
} from './session-archive.js';
import { includeArchivedSessions } from './session-list-query.js';
import { createExtensionUIController } from './extension-ui.js';
import { adaptQuestionToolForDesktop } from './question-desktop.js';
import {
  PLAN_MODE_STATE_ENTRY_TYPE,
  applyMockPlanCommand,
  isGoalCommandUserText,
  isGoalMutexHeld,
  isGoalSystemPreamble,
  reconcileListedPiGoalMetadata,
  isPlanMutexHeld,
  isUnhelpfulSessionTitle,
  parseSessionEntriesFromJsonl,
  parseSessionPlanAction,
  settlePlanReadyPrompt,
  restoreSessionPlanState,
  resumeSavedPlanState,
  resolvePlanModeState,
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
  listNestedSessionRuns,
  preferSubagentTitle,
  readSessionCwdFromSessionFile,
  readSessionIdFromSessionFile,
  readSessionTitleFromSessionFile,
  reconcileParentSubagentRuns,
  toPublicSubagentRun,
} from './subagent-runs.js';
import {
  buildSessionHtml,
  buildSessionJsonl,
  cloneImportedMessages,
  facadeFilePartFromUnknown,
  facadeMessagesFromPiEntries,
  applySessionRuntimeFromEntries,
  lastModelChangeFromEntries,
  lastThinkingLevelChangeFromEntries,
  lastModelChangeFromMessages,
  parseSessionImport,
  persistFacadeMessages,
  rememberUserContext,
  applyPersistedUserContext,
  reconcileHydratedMessages,
  resolveUsableFacadeModel,
  stampGoalCommandChronology,
  sanitizeExportBasename,
  transcriptEntriesForHydrate,
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
    const active = findSessionJsonlById(dir, id);
    if (active) return active;
    const archived = findSessionJsonlById(sessionArchiveDir(dir), id, { skipArchive: false });
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

/**
 * Busy prompt_async must call AgentSession.steer / followUp, never prompt().
 * Pi finishes the assistant message before tools run, so isStreaming on a
 * snapshot can be stale while record.status is still busy.
 */
export const resolvePromptDelivery = ({ delivery, isStreaming, statusType } = {}) => {
  const busy = Boolean(isStreaming) || statusType === 'busy' || statusType === 'retry';
  const kind = delivery === 'followUp' || delivery === 'follow_up' || delivery === 'queue'
    ? 'followUp'
    : delivery === 'steer'
      ? 'steer'
      : null;
  if (kind === 'followUp') return busy ? 'followUp' : 'prompt';
  if (kind === 'steer') return busy ? 'steer' : 'prompt';
  if (busy) return 'steer';
  return 'prompt';
};

export const isAgentAlreadyProcessingError = (error) => (
  /already processing|already streaming|streamingBehavior|steer or followUp/i.test(String(error?.message || ''))
);

const createDeferred = () => {
  let resolve = () => {};
  let settled = false;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return {
    promise,
    resolve() {
      if (settled) return;
      settled = true;
      resolve();
    },
    get settled() {
      return settled;
    },
  };
};

const ensurePromptStartedGate = (record) => {
  if (!record.promptStarted || record.promptStarted.settled) {
    record.promptStarted = createDeferred();
  }
  return record.promptStarted;
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

export { isGoalSystemPreamble } from './session-plan.js';

export const titleFromUserText = (text) => {
  let line = String(text || '').replace(/\s+/g, ' ').trim();
  if (isGoalSystemPreamble(line)) return '';
  line = line.replace(/^\/(?:goal|plan)(?::\d+)?\s+/i, '');
  if (!line) return '';
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}...` : line;
};

const userTextFromPiContent = (content) => {
  if (typeof content === 'string' && content.trim()) return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => (typeof item?.text === 'string' ? item.text : ''))
    .join('')
    .trim();
};

export const firstUserTextFromPiEntries = (entries) => {
  let fallback = '';
  for (const entry of Array.isArray(entries) ? entries : []) {
    const message = entry?.message || entry;
    if (message?.role !== 'user') continue;
    const text = userTextFromPiContent(message.content);
    if (!text || isGoalSystemPreamble(text) || isUnhelpfulSessionTitle(text)) continue;
    if (isGoalCommandUserText(text)) return text;
    if (!fallback) fallback = text;
  }
  return fallback;
};

const FIRST_USER_TEXT_FILE_LIMIT = 32 * 1024;

export const firstUserTextFromSessionFile = (filePath) => {
  const file = typeof filePath === 'string' ? filePath.trim() : '';
  if (!file || !fs.existsSync(file)) return '';
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(FIRST_USER_TEXT_FILE_LIMIT);
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
      const text = buffer.slice(0, bytes).toString('utf8');
      let fallback = '';
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        const message = parsed?.message || parsed;
        if (message?.role !== 'user') continue;
        const userText = userTextFromPiContent(message.content);
        if (!userText || isGoalSystemPreamble(userText) || isUnhelpfulSessionTitle(userText)) continue;
        if (isGoalCommandUserText(userText)) return userText;
        if (!fallback) fallback = userText;
      }
      return fallback;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
  }
  return '';
};

const firstUserText = (store) => {
  let fallback = '';
  for (const entry of store.messages || []) {
    if (entry?.info?.role !== 'user') continue;
    const part = (entry.parts || []).find((item) => item?.type === 'text' && typeof item.text === 'string' && item.text.trim());
    if (!part || isGoalSystemPreamble(part.text) || isUnhelpfulSessionTitle(part.text)) continue;
    if (isGoalCommandUserText(part.text)) return part.text;
    if (!fallback) fallback = part.text;
  }
  return fallback;
};

const persistConversationTitle = (record, title) => {
  const next = typeof title === 'string' ? title.trim() : '';
  if (!next || typeof record?.sessionManager?.appendSessionInfo !== 'function') return;
  try {
    record.sessionManager.appendSessionInfo(next);
  } catch {
  }
};

const maybeApplyConversationTitle = (record) => {
  if (!record?.info) return false;
  if (!isPlaceholderSessionTitle(record.info.title) && !isUnhelpfulSessionTitle(record.info.title)) {
    return false;
  }
  const next = titleFromUserText(firstUserText(record));
  if (!next || isUnhelpfulSessionTitle(next)) return false;
  record.info.title = next;
  record.info.time = { ...(record.info.time || {}), updated: Date.now() };
  persistConversationTitle(record, next);
  return true;
};

const isClientGeneratedMessageId = (id) => typeof id === 'string' && /^(msg_|usr_)/.test(id);

const lastUserMessage = (store) => {
  for (let index = store.messages.length - 1; index >= 0; index -= 1) {
    const entry = store.messages[index];
    if (entry?.info?.role === 'user' && entry.info.id) return entry;
  }
  return undefined;
};

const applyAssistantParent = (store, nextInfo) => {
  if (!nextInfo || nextInfo.role !== 'assistant') return nextInfo;
  const fallback = lastUserMessage(store)?.info?.id;
  if (!fallback) return nextInfo;
  const incoming = typeof nextInfo.parentID === 'string' ? nextInfo.parentID.trim() : '';
  if (!incoming) return { ...nextInfo, parentID: fallback };
  if (store.messages.some((entry) => entry?.info?.id === incoming)) return nextInfo;
  return { ...nextInfo, parentID: fallback };
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
    let nextInfo = applyAssistantParent(
      store,
      stampAssistantStoreInfo(props.info, store, existing?.info),
    );
    if (ocEvent.properties) ocEvent.properties.info = nextInfo;
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
    } else if (
      nextInfo.role === 'user'
      && !isClientGeneratedMessageId(nextInfo.id)
      && store.messages.some((entry) => (
        entry?.info?.role === 'user' && isClientGeneratedMessageId(entry.info.id)
      ))
    ) {
      // Pi jsonl id for a turn promptAsync already inserted with msg_*.
    } else {
      store.messages.push({ info: nextInfo, parts: [] });
    }
  }
  if (type === 'message.part.updated' && props.part) {
    const messageID = props.part.messageID;
    let entry = store.messages.find((item) => item.info.id === messageID);
    if (!entry) {
      const parent = lastUserMessage(store);
      const stub = applyAssistantParent(store, {
        id: messageID,
        sessionID: props.part.sessionID,
        role: 'assistant',
        time: { created: Date.now() },
        ...(parent?.info?.agent ? { agent: parent.info.agent } : { agent: 'pi' }),
      });
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
    } else if (
      entry.info.role === 'user'
      && props.part.type === 'text'
      && isGoalSystemPreamble(props.part.text)
    ) {
      if (entry.parts.length === 0) {
        store.messages = store.messages.filter((item) => item !== entry);
      }
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

const isNarrowThinkingAvailable = (available) => (
  !Array.isArray(available)
  || available.length === 0
  || (available.length === 1 && available[0] === 'off')
);

const parseThinkingLevelList = (value) => {
  if (!Array.isArray(value)) return [];
  const next = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const level = item.trim();
    if (!THINKING_LEVELS.includes(level) || seen.has(level)) continue;
    seen.add(level);
    next.push(level);
  }
  return next;
};

const findRuntimeModel = (available, ref) => {
  if (!ref || !Array.isArray(available)) return null;
  const providerID = typeof ref.providerID === 'string' ? ref.providerID.trim()
    : (typeof ref.provider === 'string' ? ref.provider.trim() : '');
  const modelID = typeof ref.modelID === 'string' ? ref.modelID.trim()
    : (typeof ref.id === 'string' ? ref.id.trim() : '');
  if (!modelID && !providerID) return null;
  const raw = providerID && modelID ? `${providerID}/${modelID}` : modelID;
  return available.find((item) => (
    item.id === raw
    || (item.id === modelID && (!providerID || item.provider === providerID))
  )) || null;
};

let supportedThinkingLevelsFn;

const loadSupportedThinkingLevels = async () => {
  if (supportedThinkingLevelsFn !== undefined) return supportedThinkingLevelsFn;
  try {
    const compat = await import('@earendil-works/pi-ai/compat');
    supportedThinkingLevelsFn = typeof compat.getSupportedThinkingLevels === 'function'
      ? compat.getSupportedThinkingLevels
      : null;
  } catch {
    supportedThinkingLevelsFn = null;
  }
  return supportedThinkingLevelsFn;
};

const readThinkingLevelsFromModel = async (model) => {
  if (!model || typeof model !== 'object') return [];
  const fromSdk = await loadSupportedThinkingLevels();
  if (fromSdk) {
    try {
      const levels = parseThinkingLevelList(fromSdk(model));
      if (!isNarrowThinkingAvailable(levels)) return levels;
    } catch {
    }
  }
  return parseThinkingLevelList(model.thinkingLevels || model.availableThinkingLevels);
};

const widenThinkingAvailable = (live, catalog) => {
  const catalogLevels = parseThinkingLevelList(catalog);
  if (catalogLevels.length === 0) return parseThinkingLevelList(live);
  if (isNarrowThinkingAvailable(live) && catalogLevels.length > 0) return catalogLevels;
  return parseThinkingLevelList(live);
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

const commandNameOf = (command) => {
  const raw = typeof command?.name === 'string' && command.name.trim()
    ? command.name
    : (typeof command?.invocationName === 'string' ? command.invocationName : '');
  return raw.trim().replace(/^\//, '');
};

const isPluginSlotOn = (payload, slot) => Boolean(
  payload?.slots?.[slot]?.installed && payload?.slots?.[slot]?.enabled,
);

const isExtensionCommandSource = (source) => (
  source !== 'prompt' && source !== 'skill' && source !== 'builtin'
);

const normalizeLiveCommand = (command) => {
  const name = commandNameOf(command);
  if (!name) return null;
  const invocation = typeof command?.invocationName === 'string'
    ? command.invocationName.trim().replace(/^\//, '')
    : '';
  const entry = {
    name,
    description: command.description || '',
    source: command.source || 'extension',
  };
  if (invocation && invocation !== name) entry.invocationName = invocation;
  return entry;
};

/** Live session getCommands() / extensionRunner.registerCommand results. */
export const readLiveSessionCommands = (piSession) => {
  if (!piSession || typeof piSession !== 'object') return [];
  if (typeof piSession.getCommands === 'function') {
    try {
      const commands = piSession.getCommands();
      if (Array.isArray(commands) && commands.length > 0) {
        return commands;
      }
    } catch {
    }
  }
  const registered = piSession.extensionRunner?.getRegisteredCommands?.();
  if (!Array.isArray(registered)) return [];
  return registered.map(normalizeLiveCommand).filter(Boolean);
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

const commandMatchesName = (command, requested) => {
  if (!requested) return false;
  if (commandNameOf(command) === requested) return true;
  const invocation = typeof command?.invocationName === 'string'
    ? command.invocationName.trim().replace(/^\//, '')
    : '';
  return invocation === requested;
};

const findLiveSessionCommand = (piSession, name) => (
  readLiveSessionCommands(piSession).find((item) => commandMatchesName(item, name))
);

const isLeftoverPlanStartStreamError = (error) => {
  const status = Number(error?.status);
  if (status === 404 || status === 409 || status === 400) return false;
  return isAgentAlreadyProcessingError(error);
};

const rollbackFacadeUserMessage = (emit, record, userMessageID) => {
  if (!record || !userMessageID) return false;
  const before = Array.isArray(record.messages) ? record.messages.length : 0;
  record.messages = (record.messages || []).filter((entry) => entry?.info?.id !== userMessageID);
  if ((record.messages || []).length === before) return false;
  if (record.translator?.userMessageID === userMessageID) {
    record.translator.clearUserMessage?.();
  }
  emit(record.directory, {
    id: createEventId(),
    type: 'message.removed',
    properties: { sessionID: record.id, messageID: userMessageID },
  });
  return true;
};

const logPromptAsyncFailure = ({
  sessionID,
  parentIsStreaming,
  childIsStreaming,
  delivery,
  messageID,
  error,
}) => {
  console.error('[pi-host] promptAsync failed', {
    sessionID,
    parentIsStreaming: Boolean(parentIsStreaming),
    childIsStreaming: Boolean(childIsStreaming),
    delivery: delivery || null,
    messageID: messageID || null,
    error: error?.message || String(error),
  });
};

const liveCommandInvocation = (command, fallback) => {
  const invocation = typeof command?.invocationName === 'string'
    ? command.invocationName.trim().replace(/^\//, '')
    : '';
  return invocation || commandNameOf(command) || fallback;
};

const refreshRecordCommands = async (record) => {
  if (typeof record?.piSession?.refreshSnapshot !== 'function') return;
  try {
    await record.piSession.refreshSnapshot();
  } catch {
  }
};

const appendFacadeUserMessage = (emit, record, body, userText) => {
  const sessionID = record.id;
  const userMessageID = body.messageID || createMessageId();
  const userAgent = typeof body.agent === 'string' && body.agent.trim() ? body.agent : 'pi';
  if (record.messages.some((entry) => entry.info.id === userMessageID)) {
    return userMessageID;
  }
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
  return userMessageID;
};

const emitFacadeMessage = (emit, record, entry) => {
  if (!entry?.info) return;
  emit(record.directory, {
    id: createEventId(),
    type: 'message.updated',
    properties: { sessionID: record.id, info: entry.info },
  });
};

const writePiGoalMarker = (record, active) => {
  if (!record?.info) return;
  const existing = record.info.metadata?.pichamber?.piGoal;
  record.info.metadata = {
    ...(record.info.metadata || {}),
    pichamber: {
      ...(record.info.metadata?.pichamber || {}),
      piGoal: existing && typeof existing === 'object'
        ? { ...existing, active }
        : { active },
    },
  };
};

const placeGoalCommandUserMessage = (emit, record, userMessageID, insertAt) => {
  const messages = record?.messages;
  if (!Array.isArray(messages) || !userMessageID) return;
  let index = messages.findIndex((entry) => entry?.info?.id === userMessageID);
  if (index < 0) return;
  const at = Math.min(Math.max(insertAt, 0), messages.length);
  if (index !== at) {
    const [goal] = messages.splice(index, 1);
    messages.splice(Math.min(at, messages.length), 0, goal);
    index = messages.findIndex((entry) => entry?.info?.id === userMessageID);
  }
  stampGoalCommandChronology(messages);
  for (let i = index; i < messages.length; i += 1) {
    emitFacadeMessage(emit, record, messages[i]);
  }
};

const createLocalReply = (emit) => (record, body, userText, assistantText) => {
  const sessionID = record.id;
  const userMessageID = appendFacadeUserMessage(emit, record, body, userText);

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

const logSkippedUserExtension = (skip) => {
  const details = [
    skip?.source && `source=${skip.source}`,
    skip?.nodePath && `node=${skip.nodePath}`,
    skip?.loaderAbi && `loaderAbi=${skip.loaderAbi}`,
    skip?.compilerAbi && `compilerAbi=${skip.compilerAbi}`,
    skip?.electronVersion && `electron=${skip.electronVersion}`,
  ].filter(Boolean);
  console.warn(`[pi-host] skipped user extension native (${details.join(' ')})`);
};

export const createPiHost = ({
  createSession,
  createSessionManager,
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
  getProcessVersions,
  userExtensionNativeLoadModule,
  rebuildUserExtensionNative,
  spawnUserExtensionRebuild,
  electronNativeIsolation,
  allowInMemoryFallback = true,
} = {}) => {
  const sessions = new Map();
  const sessionTodos = new Map();
  const hydrating = new Map();
  const directoryRuntimes = new Map();
  let modelRuntime = null;
  let modelRuntimeError = null;
  let readyPromise = null;
  const skippedUserExtensions = createUserExtensionNativeSkipStore();
  const resolveProcessVersions = () => (
    typeof getProcessVersions === 'function' ? getProcessVersions() : process.versions
  );
  const isolateUserNativesInElectron = electronNativeIsolation !== false
    && (electronNativeIsolation === true || isElectronProcess(resolveProcessVersions()));
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

  const harvestUserExtensionNativeSkips = (errors, directory) => {
    const skipped = collectSkippedUserExtensionsFromErrors(errors, {
      agentDir: resolveAgentDir(),
      projectDir: directory || defaultDirectory,
      versions: resolveProcessVersions(),
    });
    rememberSkippedUserExtensions(skippedUserExtensions, skipped, logSkippedUserExtension);
    return skipped;
  };

  const harvestExtensionsResult = (result, directory) => {
    if (!result) return;
    harvestUserExtensionNativeSkips(result.errors, directory);
    if (typeof result.getExtensions === 'function') {
      harvestUserExtensionNativeSkips(result.getExtensions()?.errors, directory);
    }
    if (typeof result.resourceLoader?.getExtensions === 'function') {
      harvestUserExtensionNativeSkips(result.resourceLoader.getExtensions()?.errors, directory);
    }
  };

  const electronTreeContext = (directory) => ({
    agentDir: resolveAgentDir(),
    projectDir: directory || defaultDirectory,
    versions: resolveProcessVersions(),
    ...(typeof rebuildUserExtensionNative === 'function'
      ? { rebuildPackage: rebuildUserExtensionNative }
      : {}),
    ...(typeof spawnUserExtensionRebuild === 'function'
      ? { spawnImpl: spawnUserExtensionRebuild }
      : {}),
  });

  const syncElectronNativeTree = async (directory) => {
    if (!isolateUserNativesInElectron) {
      return { enabled: false, isolated: [], skipped: [], failed: [] };
    }
    try {
      return await syncUserExtensionElectronTree(electronTreeContext(directory));
    } catch (error) {
      console.warn(`[pi-host] electron native tree sync failed: ${error?.message || error}`);
      return { enabled: false, isolated: [], skipped: [], failed: [] };
    }
  };

  const runWithUserExtensionNativeGuard = async (directory, operation) => {
    await syncElectronNativeTree(directory);
    const helpers = createElectronTreeLoadHelpers(electronTreeContext(directory));
    return withUserExtensionNativeGuard({
      agentDir: resolveAgentDir(),
      projectDir: directory || defaultDirectory,
      versions: resolveProcessVersions(),
      store: skippedUserExtensions,
      remapLoad: helpers.remapLoad,
      captureLazyNative: helpers.captureLazyNative,
      resolveFilenameFallback: helpers.resolveFilenameFallback,
      ...(typeof userExtensionNativeLoadModule === 'function'
        ? { loadModule: userExtensionNativeLoadModule }
        : {}),
    }, async (guard) => {
      const result = await operation(guard);
      harvestExtensionsResult(result, directory);
      return result;
    });
  };

  const invokeSessionFactory = async (factory, args) => {
    const customTools = await resolveCustomTools();
    const session = await runWithUserExtensionNativeGuard(args?.cwd, async () => (
      factory({ ...args, customTools })
    ));
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
    const seenPaths = new Set();
    const addItems = (batch) => {
      for (const item of batch || []) {
        if (!item?.path || seenPaths.has(item.path)) continue;
        seenPaths.add(item.path);
        items.push(item);
      }
    };
    try {
      addItems(await listSessionsInDir(cwd, sessionDir) || []);
    } catch {
      // Active-dir list failed: keep going. Do not pretend the directory is empty
      // if archive/ or live sessions still have rows.
    }
    try {
      for (const file of walkSessionJsonlFiles(sessionDir)) {
        if (isTopLevelUserSessionFile(file) || seenPaths.has(file)) continue;
        const id = readSessionIdFromJsonlHeader(file);
        if (!id) continue;
        let stat;
        try {
          stat = fs.statSync(file);
        } catch {
          continue;
        }
        addItems([{
          id,
          path: file,
          cwd,
          created: stat.birthtime || stat.mtime,
          modified: stat.mtime,
          firstMessage: firstUserTextFromSessionFile(file),
        }]);
      }
    } catch {
      // Nested walk failed: keep SessionManager.list rows.
    }
    if (includeArchived) {
      try {
        addItems(await listSessionsInDir(cwd, sessionArchiveDir(sessionDir)) || []);
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
        await ensureDirectoryRuntime(cwd);
        // Goal and Plan register one runtime per extension factory and then
        // call `pi.sendUserMessage`. Reusing directory services makes every
        // chat in that project share one factory, so /goal and /plan start
        // on another session. Each user chat gets its own AgentSession.
        const created = await pi.createAgentSession({
          cwd,
          agentDir: resolveAgentDir(),
          modelRuntime: runtime,
          ...(model ? { model } : {}),
          sessionManager: sessionManager || pi.SessionManager.create(cwd, sessionDirForCwd(cwd, home)),
          ...(customTools ? { customTools } : {}),
        });
        harvestExtensionsResult(created?.extensionsResult || created, cwd);
        return created?.session || created;
      };
    } catch (error) {
      if (allowInMemoryFallback === false) {
        throw error;
      }
      console.warn('[pi-host] @earendil-works/pi-coding-agent unavailable, using in-memory mock session:', error?.message || error);
      return async () => createInMemoryPiSession();
    }
  };

  const ensureModelRuntime = async () => {
    if (modelRuntime) return modelRuntime;
    if (typeof createModelRuntime === 'function') {
      modelRuntime = await createModelRuntime();
      return modelRuntime;
    }
    if (mock) return modelRuntime;
    if (modelRuntimeError) throw modelRuntimeError;
    try {
      hydrateKnownModelCapabilities({ home, directory: defaultDirectory });
      const pi = await loadPiSdk();
      const agentDir = resolveAgentDir();
      modelRuntime = await pi.ModelRuntime.create({
        allowModelNetwork: false,
        authPath: resolvePiAuthPath(home),
        modelsPath: resolvePiModelsPath(home),
        agentDir,
      });
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
        const services = await runWithUserExtensionNativeGuard(cwd, async () => (
          pi.createAgentSessionServices({ cwd, agentDir: resolveAgentDir() })
        ));
        harvestExtensionsResult(services, cwd);
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
      const runtime = await runWithUserExtensionNativeGuard(directory, async () => (
        pi.createAgentSessionRuntime(factory, {
          cwd: directory,
          agentDir: resolveAgentDir(),
          sessionManager: pi.SessionManager.inMemory(directory),
        })
      ));
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
    // Tool events do not themselves emit session.status. After a false settle
    // (prompt IPC finally / empty snapshot) the rest of the turn would look
    // idle in the sidebar unless we revive busy here.
    if (
      (piEvent?.type === 'tool_execution_start' || piEvent?.type === 'tool_execution_update')
      && record.status?.type !== 'busy'
      && record.status?.type !== 'retry'
    ) {
      // Revive sidebar busy only. Do not latch turnActive: injected tool
      // events (todo snapshots, tests) must still allow idle reload.
      record.status = { type: 'busy' };
      emit(record.directory, {
        id: createEventId(),
        type: 'session.status',
        properties: { sessionID: record.id, status: { type: 'busy' } },
      });
    }
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
    if (
      piEvent?.type === 'tool_execution_end'
      && !recordHasRunningToolParts(record)
      && !sessionIsLive(record)
      && record.turnActive !== true
    ) {
      if (record.status?.type === 'busy' || record.status?.type === 'retry') {
        record.status = { type: 'idle' };
        emit(record.directory, {
          id: createEventId(),
          type: 'session.status',
          properties: { sessionID: record.id, status: { type: 'idle' } },
        });
      }
    }
    if (piEvent?.type === 'agent_settled') {
      record.turnActive = false;
      record.promptStarted?.resolve?.();
      syncPiGoalMarker(record);
    }
    return ocEvents;
  };

  const syncPiGoalMarker = (record) => {
    if (!record?.info) return false;
    const current = record.info.metadata?.pichamber?.piGoal;
    const wasActive = current === true
      || (current && typeof current === 'object' && current.active === true);
    if (!wasActive && current == null) return false;
    const active = isGoalMutexHeld(readRecordEntries(record), readRecordDiskEntries(record));
    if (current && typeof current === 'object' && current.active === active) return false;
    writePiGoalMarker(record, active);
    persistSessionMetadata(record.sessionManager, record.info.metadata);
    emit(record.directory, {
      id: createEventId(),
      type: 'session.updated',
      properties: { info: record.info },
    });
    return true;
  };

  const recordHasRunningToolParts = (record) => {
    const messages = record?.messages;
    if (!Array.isArray(messages)) return false;
    for (const entry of messages) {
      const parts = Array.isArray(entry?.parts) ? entry.parts : [];
      for (const part of parts) {
        if (part?.type === 'tool' && part?.state?.status === 'running') return true;
      }
    }
    return false;
  };

  const sessionIsLive = (record) => (
    Boolean(record?.piSession?.isStreaming) || Boolean(record?.piSession?.isCompacting)
  );

  const settleRecordIfStuck = (record) => {
    if (!record || sessionIsLive(record) || recordHasRunningToolParts(record)) return false;
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
      await refreshRecordCommands(record);
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
    lastModelChangeFromEntries(record?.entries),
    lastModelChangeFromMessages(record?.messages),
    readPiDefaults(home).model,
  );

  const createRecordTranslator = (sessionID, directory, record) => createEventTranslator({
    sessionID,
    directory,
    fallbackModel: resolveHostFallbackModel(record),
  });

  const hydrateFacadeMessages = (entries, sessionID, record) => {
    const messages = facadeMessagesFromPiEntries(entries, sessionID, {
      fallbackModel: resolveHostFallbackModel(record),
    });
    const filtered = messages.filter((entry) => {
      if (entry?.info?.role !== 'user') return true;
      const text = (entry.parts || [])
        .map((part) => (part?.type === 'text' && typeof part.text === 'string' ? part.text : ''))
        .join('')
        .trim();
      return !isGoalSystemPreamble(text);
    });
    const metadata = record?.info?.metadata || readPersistedSessionMetadata(entries);
    return applyPersistedUserContext(filtered, metadata);
  };

  const createPersistedSessionManager = async (cwd, { title } = {}) => {
    if (typeof createSessionManager === 'function') {
      return createSessionManager(cwd, { title });
    }
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

  const applyLiveSessionDefaults = (piSession) => {
    try {
      const defaults = readPiDefaults(home);
      if (typeof piSession?.setThinkingLevel !== 'function') return;
      let level = defaults.thinking;
      if (typeof piSession.getAvailableThinkingLevels === 'function') {
        const levels = piSession.getAvailableThinkingLevels();
        if (Array.isArray(levels) && levels.length > 0 && !levels.includes(level)) {
          level = levels.includes('medium') ? 'medium' : levels[0];
        }
      }
      piSession.setThinkingLevel(level);
    } catch {
    }
  };

  const liveBindings = new Map();

  const hasLivePrompt = (record) => (
    Boolean(record?.piSession) && typeof record.piSession.prompt === 'function'
  );

  const publishCreatedRecord = (record) => {
    sessions.set(record.id, record);
    sessionTodos.set(record.id, []);
    emit(record.directory, {
      id: createSessionId().replace('ses_', 'evt_'),
      type: 'session.created',
      properties: { info: record.info },
    });
    return record;
  };

  const markRecordDisposed = (record) => {
    if (!record) return;
    record.disposed = true;
    liveBindings.delete(record.id);
  };

  const disposedSessionError = (record) => {
    const error = new Error(`Session not found: ${record.id}`);
    error.status = 404;
    return error;
  };

  const bindLiveRecord = async (record) => {
    if (record.disposed) throw disposedSessionError(record);
    if (hasLivePrompt(record)) return record;
    const cwd = record.directory;
    await ensureDirectoryRuntime(cwd);
    if (record.disposed) throw disposedSessionError(record);
    const factory = await resolveCreateSession();
    const model = await resolvePreferredModel();
    const piSession = await invokeSessionFactory(factory, {
      cwd,
      directory: cwd,
      modelRuntime,
      model,
      sessionManager: record.sessionManager,
      sessionFile: record.sessionFile,
      sessionID: record.id,
      title: record.info?.title,
    });
    if (record.disposed) {
      try { piSession?.dispose?.(); } catch {}
      throw disposedSessionError(record);
    }
    const liveId = typeof piSession?.sessionId === 'string' && piSession.sessionId.trim()
      ? piSession.sessionId.trim()
      : undefined;
    if (liveId && liveId !== record.id) {
      console.warn(`[pi-host] live session id ${liveId} != shell id ${record.id}; keeping shell id`);
    }
    record.piSession = piSession;
    if (!record.sessionFile && typeof piSession?.sessionFile === 'string') {
      record.sessionFile = piSession.sessionFile;
    }
    record.translator = createRecordTranslator(record.id, cwd, { piSession });
    applyLiveSessionDefaults(piSession);
    attachSession(record);
    if (record.disposed) {
      try { record.unsubscribe?.(); } catch {}
      try { piSession?.dispose?.(); } catch {}
      throw disposedSessionError(record);
    }
    await bindDesktopExtensionUI(record);
    if (record.disposed) {
      try { record.extensionUI?.dispose?.(); } catch {}
      try { record.unsubscribe?.(); } catch {}
      try { piSession?.dispose?.(); } catch {}
      throw disposedSessionError(record);
    }
    return record;
  };

  const ensureLiveRecord = async (record) => {
    if (!record) return record;
    if (record.disposed) throw disposedSessionError(record);
    if (hasLivePrompt(record)) return record;
    const existing = liveBindings.get(record.id);
    if (existing) return existing;
    const task = bindLiveRecord(record).catch((error) => {
      liveBindings.delete(record.id);
      throw error;
    });
    liveBindings.set(record.id, task);
    return task;
  };

  const createFacadeSessionLive = async ({ directory, title, parentID, metadata, id } = {}) => {
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
    applyLiveSessionDefaults(piSession);
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
    return publishCreatedRecord(record);
  };

  const createFacadeSession = async (input = {}) => {
    const { directory, title, parentID, metadata } = input;
    if (mock) return createFacadeSessionLive(input);
    const cwd = directory || defaultDirectory;
    const sessionManager = await createPersistedSessionManager(cwd, { title });
    const sessionID = typeof sessionManager?.getSessionId === 'function'
      ? sessionManager.getSessionId()
      : '';
    if (!sessionManager || !sessionID) {
      return createFacadeSessionLive(input);
    }
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
      sessionFile: typeof sessionManager.getSessionFile === 'function'
        ? sessionManager.getSessionFile()
        : undefined,
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
      piSession: null,
      translator: createRecordTranslator(sessionID, cwd, {}),
      unsubscribe: null,
    };
    publishCreatedRecord(record);
    void ensureLiveRecord(record).catch((error) => {
      console.warn(`[pi-host] live bind failed for ${record.id}:`, error?.message || error);
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
      if (allowInMemoryFallback === false) {
        throw error;
      }
      console.warn(`[pi-host] failed to attach live Pi session ${sessionID}:`, error?.message || error);
      piSession = createInMemoryPiSession({ sessionId: sessionID });
    }
    const entries = transcriptEntriesForHydrate({ file, manager });
    applySessionRuntimeFromEntries(piSession, entries);
    const storedName = (typeof manager.getSessionName === 'function' && manager.getSessionName())
      || persisted?.name;
    const title = resolveListedSessionTitle({
      name: storedName,
      firstMessage: persisted?.firstMessage || firstUserTextFromPiEntries(entries),
    });
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
          parentID: readListedParentID(metadata, file),
          projectID: cwd,
          metadata,
        }),
        time: sessionTimeWithArchived({
          created: Number.isFinite(created) ? created : Date.now(),
          updated: Number.isFinite(updated) ? updated : Date.now(),
        }, metadata),
      },
      messages: hydrateFacadeMessages(entries, sessionID, { piSession, entries }),
      status: { type: 'idle' },
      piSession,
      translator: createRecordTranslator(sessionID, cwd, { piSession }),
      unsubscribe: null,
    };
    attachSession(record);
    if (isPlaceholderSessionTitle(storedName) && !isPlaceholderSessionTitle(title)) {
      persistConversationTitle(record, title);
    }
    await bindDesktopExtensionUI(record);
    sessions.set(sessionID, record);
    publishRecordTodos(record, entries);
    syncPiGoalMarker(record);
    return record;
  };

  const readRecordEntries = (record) => {
    const manager = record?.sessionManager || record?.piSession?.sessionManager;
    if (typeof manager?.getEntries === 'function') return manager.getEntries();
    if (typeof manager?.getBranch === 'function') return manager.getBranch();
    return [];
  };

  const readRecordDiskEntries = (record) => {
    const file = typeof record?.sessionFile === 'string' && record.sessionFile
      ? record.sessionFile
      : (typeof record?.piSession?.sessionFile === 'string' ? record.piSession.sessionFile : '');
    if (!file) return [];
    try {
      return parseSessionEntriesFromJsonl(fs.readFileSync(file, 'utf8'));
    } catch {
      return [];
    }
  };

  const readRecordPlan = (record) => {
    const live = typeof record?.piSession?.getPlanModeState === 'function'
      ? record.piSession.getPlanModeState()
      : null;
    return sessionPlanFromState(resolvePlanModeState(
      live,
      readRecordEntries(record),
      readRecordDiskEntries(record),
    ));
  };

  const persistRecordPlanState = async (record, next) => {
    const manager = record?.sessionManager || record?.piSession?.sessionManager;
    const write = (fn, ...args) => {
      const result = fn(...args);
      return result && typeof result.then === 'function' ? result : undefined;
    };
    if (typeof manager?.appendCustomEntry === 'function') {
      await write(manager.appendCustomEntry.bind(manager), PLAN_MODE_STATE_ENTRY_TYPE, next);
      return;
    }
    if (typeof record?.piSession?.setPlanModeState === 'function') {
      await write(record.piSession.setPlanModeState.bind(record.piSession), next);
    } else if (typeof record?.piSession?.appendEntry === 'function') {
      await write(record.piSession.appendEntry.bind(record.piSession), PLAN_MODE_STATE_ENTRY_TYPE, next);
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

  const subagentsSlotActive = () => isSubagentsSlotActive(toFeaturePluginsPayload({
    plugins: readFeaturePlugins(home),
    configuredSources: listConfiguredPiPackageSources(home),
  }));

  const isAdapterSubagentInfo = (info, record = info?.id ? sessions.get(info.id) : undefined) => Boolean(
    record?.subagentRun
    || (info?.metadata && typeof info.metadata === 'object' && info.metadata.pichamber?.subagentRun)
  );

  const persistAdapterParentID = (record, parentID) => {
    if (!record?.info || typeof parentID !== 'string' || !parentID.trim()) return false;
    const nextParentID = parentID.trim();
    const existingRun = record.info.metadata?.pichamber?.subagentRun;
    const metadata = {
      ...(record.info.metadata || {}),
      parentID: nextParentID,
      pichamber: {
        ...(record.info.metadata?.pichamber || {}),
        subagentRun: {
          ...(existingRun && typeof existingRun === 'object' ? existingRun : {}),
          parentSessionID: nextParentID,
        },
      },
    };
    record.info.metadata = metadata;
    const persisted = persistSessionMetadata(record.sessionManager, metadata);
    if (!persisted && typeof record.sessionFile === 'string' && record.sessionFile) {
      try {
        fs.appendFileSync(record.sessionFile, `${JSON.stringify({
          type: 'custom',
          customType: PICHAMBER_METADATA_CUSTOM_TYPE,
          data: { parentID: nextParentID, pichamber: metadata.pichamber },
        })}\n`);
      } catch {
        return false;
      }
    } else if (!persisted) {
      return false;
    }
    if (typeof record.sessionFile === 'string' && record.sessionFile) {
      record.sessionFileStamp = statSessionFile(record.sessionFile);
    }
    return true;
  };

  const applySubagentParentLink = (record, parentID, extraMetadata, { emitUpdated = true } = {}) => {
    if (!record?.info || typeof parentID !== 'string' || !parentID.trim()) return record;
    const nextParentID = parentID.trim();
    // Adapter children live under async-subagent-runs or a nested
    // session.jsonl. A top-level `{timestamp}_{id}.jsonl` chat is its own
    // conversation — status/debug dumps must not reparent it.
    if (isTopLevelUserSessionFile(record.sessionFile)) return record;
    const previousParentID = typeof record.info.parentID === 'string' && record.info.parentID.trim()
      ? record.info.parentID.trim()
      : undefined;
    const gained = previousParentID !== nextParentID;
    record.info.parentID = nextParentID;
    if (extraMetadata && typeof extraMetadata === 'object') {
      record.info.metadata = { ...(record.info.metadata || {}), ...extraMetadata };
    }
    const storedParentID = typeof record.info.metadata?.parentID === 'string'
      ? record.info.metadata.parentID.trim()
      : '';
    if (storedParentID !== nextParentID) {
      persistAdapterParentID(record, nextParentID);
    }
    if (gained && emitUpdated) {
      emit(record.directory, {
        id: createEventId(),
        type: 'session.updated',
        properties: { info: record.info },
      });
    }
    return record;
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
      const existingFile = typeof existing.sessionFile === 'string' ? existing.sessionFile : '';
      const alreadyLinked = typeof existing.info?.parentID === 'string' ? existing.info.parentID.trim() : '';
      if (existingFile && existingFile !== resolvedFile && alreadyLinked && alreadyLinked !== parentID) {
        return existing;
      }
      applySubagentParentLink(existing, parentID, metadata);
      refreshChildMessagesFromFile(existing, { publish: true });
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
    const fileEntries = transcriptEntriesForHydrate({ file: resolvedFile, manager });
    const cwd = (typeof manager?.getCwd === 'function' && manager.getCwd())
      || readSessionCwdFromSessionFile(resolvedFile)
      || directory
      || defaultDirectory;
    const resolvedId = (typeof manager?.getSessionId === 'function' && manager.getSessionId())
      || sessionID
      || readSessionIdFromSessionFile(resolvedFile);
    if (!resolvedId) {
      throw missingSession(sessionID || resolvedFile);
    }
    if (!manager && !mock) {
      throw missingSession(resolvedId);
    }
    const alreadyAttached = sessions.get(resolvedId);
    if (alreadyAttached) {
      const existingFile = typeof alreadyAttached.sessionFile === 'string' ? alreadyAttached.sessionFile : '';
      const alreadyLinked = typeof alreadyAttached.info?.parentID === 'string' ? alreadyAttached.info.parentID.trim() : '';
      if (existingFile && existingFile !== resolvedFile && alreadyLinked && alreadyLinked !== parentID) {
        return alreadyAttached;
      }
      applySubagentParentLink(alreadyAttached, parentID, metadata);
      refreshChildMessagesFromFile(alreadyAttached, { publish: true });
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
        sessionManager: manager,
      });
    } catch (error) {
      if (allowInMemoryFallback === false) {
        throw error;
      }
      console.warn(`[pi-host] failed to attach subagent session ${resolvedId}:`, error?.message || error);
      piSession = createInMemoryPiSession({ sessionId: resolvedId });
    }
    const entries = fileEntries;
    applySessionRuntimeFromEntries(piSession, entries);
    const persistedMetadata = readPersistedSessionMetadata(entries);
    const listedParentID = isTopLevelUserSessionFile(resolvedFile)
      ? readListedParentID(persistedMetadata, resolvedFile)
      : (parentID || readListedParentID(persistedMetadata, resolvedFile));
    const record = {
      id: resolvedId,
      directory: cwd,
      sessionFile: resolvedFile,
      sessionManager: manager,
      info: createSessionInfo({
        id: resolvedId,
        directory: cwd,
        title: preferSubagentTitle(
          typeof manager?.getSessionName === 'function' ? manager.getSessionName() : '',
          title,
          'Subagent',
        ),
        parentID: listedParentID,
        metadata: {
          ...(persistedMetadata || {}),
          ...(isTopLevelUserSessionFile(resolvedFile) ? {} : (metadata || {})),
        },
        projectID: cwd,
      }),
      messages: hydrateFacadeMessages(entries, resolvedId, { piSession, entries }),
      status: { type: 'idle' },
      sessionFileStamp: statSessionFile(resolvedFile),
      piSession,
      translator: createRecordTranslator(resolvedId, cwd, { piSession }),
      unsubscribe: null,
    };
    attachSession(record);
    sessions.set(resolvedId, record);
    publishRecordTodos(record, entries);
    applySubagentParentLink(record, parentID || readListedParentID(persistedMetadata, resolvedFile), metadata, {
      emitUpdated: false,
    });
    emit(cwd, {
      id: createEventId(),
      type: 'session.created',
      properties: { info: record.info },
    });
    return record;
  };

  const publishRefreshedMessages = (record, previous) => {
    const before = Array.isArray(previous) ? previous : [];
    const next = Array.isArray(record?.messages) ? record.messages : [];
    if (next.length === 0) return;
    const beforeIds = new Set(before.map((entry) => entry?.info?.id).filter(Boolean));
    const grew = next.length !== before.length || next.some((entry) => entry?.info?.id && !beforeIds.has(entry.info.id));
    if (!grew && next === previous) return;
    if (!grew) {
      const lastBefore = before[before.length - 1];
      const lastNext = next[next.length - 1];
      const beforeParts = Array.isArray(lastBefore?.parts) ? lastBefore.parts.length : 0;
      const nextParts = Array.isArray(lastNext?.parts) ? lastNext.parts.length : 0;
      if (lastBefore?.info?.id === lastNext?.info?.id && beforeParts === nextParts) return;
    }
    for (const entry of next) {
      if (!entry?.info) continue;
      emit(record.directory, {
        id: createEventId(),
        type: 'message.updated',
        properties: { sessionID: record.id, info: entry.info },
      });
      for (const part of Array.isArray(entry.parts) ? entry.parts : []) {
        if (!part) continue;
        emit(record.directory, {
          id: createEventId(),
          type: 'message.part.updated',
          properties: { sessionID: record.id, part, time: Date.now() },
        });
      }
    }
  };

  const refreshChildMessagesFromFile = (record, { publish = false } = {}) => {
    const file = record?.sessionFile;
    if (!file || !fs.existsSync(file)) return false;
    const stamp = statSessionFile(file);
    if (stamp && sessionFileStampEquals(record.sessionFileStamp, stamp)) {
      return false;
    }
    try {
      const entries = transcriptEntriesForHydrate({ file, manager: record.sessionManager });
      if (!Array.isArray(entries) || entries.length === 0) return false;
      const previous = record.messages;
      record.messages = reconcileHydratedMessages(
        previous,
        hydrateFacadeMessages(entries, record.id, record),
      );
      record.sessionFileStamp = stamp;
      if (publish) publishRefreshedMessages(record, previous);
      return true;
    } catch {
      return false;
    }
  };

  const hydratedParentID = (record) => {
    const info = record?.info;
    if (!info) return '';
    if (typeof info.parentID === 'string' && info.parentID.trim()) return info.parentID.trim();
    if (typeof info.metadata?.parentID === 'string' && info.metadata.parentID.trim()) {
      return info.metadata.parentID.trim();
    }
    const nested = info.metadata?.pichamber?.subagentRun?.parentSessionID;
    return typeof nested === 'string' && nested.trim() ? nested.trim() : '';
  };

  const recordMatchesDirectory = (record, directory) => {
    if (!directory) return true;
    if (directoriesMatch(record.directory, directory)) return true;
    const parentID = hydratedParentID(record);
    if (!parentID) return false;
    const parent = sessions.get(parentID);
    return Boolean(parent && directoriesMatch(parent.directory, directory));
  };

  const collectAttachedChildRuns = (parent) => {
    const runs = [];
    for (const record of sessions.values()) {
      if (!record || record.id === parent.id) continue;
      if (isTopLevelUserSessionFile(record.sessionFile)) continue;
      if (hydratedParentID(record) !== parent.id) continue;
      const sameDirectory = record.directory === parent.directory;
      if (sameDirectory && !record.sessionFile && !record.subagentRun) continue;
      const existing = record.subagentRun;
      runs.push({
        runId: existing?.runId || record.id,
        parentID: parent.id,
        sessionID: record.id,
        sessionFile: record.sessionFile || null,
        directory: record.directory || existing?.directory || null,
        name: existing?.name || 'subagent',
        role: existing?.role || existing?.name || 'subagent',
        mode: existing?.mode || 'background',
        state: existing?.state || (record.status?.type === 'busy' ? 'running' : 'done'),
        title: preferSubagentTitle(record.info?.title, existing?.title, existing?.name),
        toolCallId: existing?.toolCallId || null,
        asyncDir: existing?.asyncDir || null,
        startedAt: existing?.startedAt || record.info?.time?.created || null,
        endedAt: existing?.endedAt || null,
      });
    }
    return runs;
  };

  const collectSubagentRuns = (parent) => {
    const liveRuns = [
      ...extractRunsFromFacadeMessages(parent.messages, parent.id),
      ...extractRunsFromPiEntries(
        typeof parent.sessionManager?.getEntries === 'function' ? parent.sessionManager.getEntries() : [],
        parent.id,
      ),
    ];
    const extraProjectDirs = [];
    const seenDirs = new Set();
    const addDir = (value) => {
      const dir = typeof value === 'string' && value.trim() ? value.trim() : '';
      if (!dir || seenDirs.has(dir) || dir === parent.directory) return;
      seenDirs.add(dir);
      extraProjectDirs.push(dir);
    };
    for (const run of liveRuns) {
      addDir(run.directory);
      addDir(readSessionCwdFromSessionFile(run.sessionFile));
    }
    const attachedRuns = collectAttachedChildRuns(parent);
    for (const run of attachedRuns) {
      addDir(run.directory);
    }
    const nestedRuns = listNestedSessionRuns({
      parent,
      sessionDir: sessionDirForCwd(parent.directory, home),
    });
    for (const run of nestedRuns) {
      addDir(run.directory);
      addDir(readSessionCwdFromSessionFile(run.sessionFile));
    }
    const fileRuns = [
      ...listAdapterRunsFromFiles({
        parent,
        projectDir: parent.directory,
        extraProjectDirs,
      }),
      ...nestedRuns,
      ...attachedRuns,
    ];
    return reconcileParentSubagentRuns(fileRuns, liveRuns);
  };

  const attachSubagentRun = async (parent, run) => {
    const childId = run?.sessionID && run.sessionID !== parent.id ? run.sessionID : null;
    if (!run?.sessionFile && !childId) return run;
    const extraMetadata = {
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
    };
    try {
      if (run.sessionFile && fs.existsSync(run.sessionFile)) {
        const record = await attachSessionFromFile(run.sessionFile, {
          sessionID: run.sessionID || undefined,
          directory: run.directory || parent.directory,
          parentID: parent.id,
          title: preferSubagentTitle(
            readSessionTitleFromSessionFile(run.sessionFile),
            run.title,
            run.name,
          ),
          metadata: extraMetadata,
        });
        record.subagentRun = run;
        applySubagentParentLink(record, parent.id, extraMetadata);
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
        return {
          ...run,
          sessionID: record.id,
          directory: record.directory || run.directory || null,
          title: preferSubagentTitle(record.info?.title, run.title, run.name),
        };
      }
      // A completed adapter can leave a stale sessionFile after its temporary
      // child workspace has been cleaned up. Fall back to the child id without
      // repeatedly attempting to hydrate the missing file.
      if (childId) {
        let record = sessions.get(childId);
        if (!record) {
          try {
            record = await ensureRecord(childId, parent.directory);
          } catch {
            return { ...run, sessionID: childId };
          }
        }
        record.subagentRun = run;
        applySubagentParentLink(record, parent.id, extraMetadata);
        return { ...run, sessionID: record.id, directory: record.directory || run.directory || null };
      }
    } catch (error) {
      if (run.sessionFile && !fs.existsSync(run.sessionFile)) {
        return { ...run, sessionID: childId || run.sessionID || null };
      }
      console.warn(`[pi-host] failed to attach subagent run ${run.runId}:`, error?.message || error);
    }
    return run;
  };

  const refreshConversationTitle = (record) => {
    if (!maybeApplyConversationTitle(record)) return false;
    emit(record.directory, {
      id: createEventId(),
      type: 'session.updated',
      properties: { info: record.info },
    });
    return true;
  };

  const ensureRecord = async (sessionID, directory) => {
    const existing = sessions.get(sessionID);
    if (existing) {
      syncPiGoalMarker(existing);
      refreshConversationTitle(existing);
      return existing;
    }
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
    if (!hasLivePrompt(record)) {
      await ensureLiveRecord(record);
    }
    record.unsubscribe?.();
    if (typeof record.piSession?.reload === 'function') {
      await runWithUserExtensionNativeGuard(record.directory, async () => {
        await record.piSession.reload();
        harvestExtensionsResult(record.piSession, record.directory);
      });
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
      if (!record.sessionManager) {
        const error = new Error(`Cannot reload session without a session file: ${record.id}`);
        error.status = 500;
        throw error;
      }
      const factory = await resolveCreateSession();
      record.piSession = await invokeSessionFactory(factory, {
        cwd: record.directory,
        modelRuntime,
        sessionManager: record.sessionManager,
      });
    }
    attachSession(record);
    await bindDesktopExtensionUI(record);
    try {
      syncRecordTodos(record);
    } catch {
      // Reload still succeeded. Keep the last good snapshot instead of [].
    }
    syncPiGoalMarker(record);
    emit(record.directory, {
      id: createEventId(),
      type: 'session.updated',
      properties: { info: record.info },
    });
  };

  const ensureLivePluginCommand = async (record, name) => {
    if (findLiveSessionCommand(record.piSession, name)) return record;
    await refreshRecordCommands(record);
    if (findLiveSessionCommand(record.piSession, name)) return record;
    record.pluginCommandReloads ??= new Set();
    if (record.pluginCommandReloads.has(name)) return null;
    const blocked = sessionBlocksPiReload(record);
    if (blocked) {
      const error = new Error(blocked);
      error.status = 409;
      throw error;
    }
    record.pluginCommandReloads.add(name);
    await reloadLiveRecord(record);
    return findLiveSessionCommand(record.piSession, name) ? record : null;
  };

  const readListMetadata = typeof readListSessionMetadata === 'function'
    ? readListSessionMetadata
    : readPersistedSessionMetadataFromFileTail;

  const toPersistedSessionInfo = (item, directory) => {
    const id = item?.id || item?.path;
    if (!id) return null;
    // Reuse title / firstMessage / timestamps from SessionManager.list().
    // Tail-scan the last pichamber.metadata (archived / parentID / Goal mark)
    // and drop a leftover 🎯 unless goal-state still holds the mutex.
    const metadata = item.path ? readListMetadata(item.path) : undefined;
    const listedMetadata = item.path
      ? reconcileListedPiGoalMetadata(metadata, item.path)
      : metadata;
    const parentID = readListedParentID(listedMetadata, item.path);
    return {
      id,
      projectID: item.cwd || directory || 'pi',
      directory: item.cwd || directory,
      title: resolveListedSessionTitle({
        ...item,
        firstMessage: item.firstMessage || firstUserTextFromSessionFile(item.path),
      }),
      version: 'pi',
      ...(parentID ? { parentID } : {}),
      ...(listedMetadata ? { metadata: listedMetadata } : {}),
      time: sessionTimeWithArchived({
        created: item.created ? new Date(item.created).getTime() : Date.now(),
        updated: item.modified ? new Date(item.modified).getTime() : Date.now(),
      }, listedMetadata),
    };
  };

  const collectSessionInfos = async (directory, query) => {
    const includeArchived = !query || includeArchivedSessions(query.archived);
    const live = Array.from(sessions.values())
      .filter((record) => recordMatchesDirectory(record, directory))
      .map((record) => {
        const current = record.info?.metadata?.pichamber?.piGoal;
        if (
          current === true
          || (current && typeof current === 'object' && current.active === true)
        ) {
          syncPiGoalMarker(record);
        }
        const listedParent = readListedParentID(record.info?.metadata, record.sessionFile);
        if (record.info?.parentID && !listedParent && isTopLevelUserSessionFile(record.sessionFile)) {
          delete record.info.parentID;
        }
        return record.info;
      })
      .filter((info) => includeArchived || !info?.time?.archived);
    const seen = new Set(live.map((info) => info.id));
    if (!mock) {
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
    }

    for (const info of live) {
      if (info.parentID) continue;
      const nested = readListedParentID(info.metadata, sessions.get(info.id)?.sessionFile);
      if (!nested) continue;
      info.parentID = nested;
      const liveRecord = sessions.get(info.id);
      if (liveRecord?.info === info) {
        emit(liveRecord.directory, {
          id: createEventId(),
          type: 'session.updated',
          properties: { info: liveRecord.info },
        });
      }
    }

    if (!subagentsSlotActive()) {
      return live.filter((info) => !isAdapterSubagentInfo(info));
    }

    const parents = live.filter((info) => info && !info.parentID);
    for (const parentInfo of parents) {
      const parent = sessions.get(parentInfo.id) || {
        id: parentInfo.id,
        directory: parentInfo.directory || directory || defaultDirectory,
        messages: [],
      };
      try {
        for (const run of collectSubagentRuns(parent)) {
          const attached = await attachSubagentRun(parent, run);
          const child = attached?.sessionID ? sessions.get(attached.sessionID) : null;
          if (!child?.info || child.id === parent.id) continue;
          if (!includeArchived && child.info.time?.archived) continue;
          if (seen.has(child.id)) {
            const index = live.findIndex((info) => info.id === child.id);
            if (index >= 0) live[index] = child.info;
            continue;
          }
          seen.add(child.id);
          live.push(child.info);
        }
      } catch {
        // One parent attach failure must not drop other complete sessions.
      }
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
      const entries = transcriptEntriesForHydrate({ file, manager });
      record.messages = reconcileHydratedMessages(
        record.messages,
        hydrateFacadeMessages(entries, record.id, record),
      );
      const title = typeof manager.getSessionName === 'function' && manager.getSessionName();
      if (title && !isPlaceholderSessionTitle(title) && !isUnhelpfulSessionTitle(title)) {
        record.info.title = title;
      } else if (maybeApplyConversationTitle(record)) {
        // Prefer /goal objective over a Goal preamble or “继续” session name.
      }
      const metadata = readPersistedSessionMetadata(entries);
      if (metadata) {
        record.info.metadata = { ...(record.info.metadata || {}), ...metadata };
      }
      const parentID = readListedParentID(metadata || record.info.metadata, record.sessionFile);
      if (parentID) record.info.parentID = parentID;
      else if (isTopLevelUserSessionFile(record.sessionFile)) delete record.info.parentID;
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
      syncPiGoalMarker(record);
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
    listSkippedUserExtensions() {
      return skippedUserExtensions.list();
    },
    async createSession(input) {
      await ready();
      return createFacadeSession(input);
    },
    async warmDirectoryRuntime(directory) {
      const cwd = typeof directory === 'string' && directory.trim() ? directory.trim() : defaultDirectory;
      await ensureDirectoryRuntime(cwd);
      return { ok: true, directory: cwd };
    },
    getSession(sessionID) {
      const record = getRecord(sessionID);
      refreshConversationTitle(record);
      return record;
    },
    async ensureSession(sessionID, directory) {
      return ensureRecord(sessionID, directory);
    },
    listSessions(directory) {
      const items = Array.from(sessions.values()).filter((record) => recordMatchesDirectory(record, directory));
      for (const record of items) {
        refreshConversationTitle(record);
      }
      return items;
    },
    async deleteSession(sessionID, directory) {
      const record = await ensureRecord(sessionID, directory);
      markRecordDisposed(record);
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
      const streamingParent = Boolean(record.piSession?.isStreaming)
        && !record.subagentRun
        && !record.info?.parentID;
      if (!streamingParent) {
        refreshChildMessagesFromFile(record, { publish: Boolean(record.subagentRun || record.info?.parentID) });
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
        if (!recordMatchesDirectory(record, directory)) continue;
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
    authorizeProviderOAuth(providerId) {
      return authorizePiXaiOAuth(providerId);
    },
    async completeProviderOAuth(providerId) {
      const credential = await completePiXaiOAuth(providerId);
      return this.setProviderAuth(providerId, credential);
    },
    getXaiUsage(options = {}) {
      return getPiXaiUsage({ home, ...options });
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
        const builtinIds = await resolvePiBuiltinCatalogIds();
        const providers = withoutUnconnectedBuiltinCatalogProviders(mapPiModelsToProviders(available, {
          configs: listPiProviderPublicConfigs({ home, directory: defaultDirectory }),
        }), {
          home,
          directory: defaultDirectory,
          builtinIds,
        });
        const first = providers[0];
        const firstModel = first ? Object.keys(first.models)[0] : undefined;
        return {
          providers,
          default: first && firstModel ? { [first.id]: firstModel } : {},
        };
      } catch {
        return {
          providers: [],
          default: {},
        };
      }
    },
    async promptAsync(sessionID, body = {}) {
      const record = await ensureRecord(sessionID);
      const modelRef = resolvePromptModelRef(body.model);
      const requestedThinking = typeof body.variant === 'string' ? body.variant.trim()
        : typeof body.thinking === 'string' ? body.thinking.trim()
        : '';
      const text = extractPromptText(body.parts) || (typeof body.text === 'string' ? body.text : '');
      if (!text) {
        const error = new Error('Message must have at least one text part');
        error.status = 400;
        throw error;
      }
      // Magic-prompt chips attach a long synthetic instruction. Keep it for
      // Pi, but the user bubble and session title stay the short visible line.
      const authoredText = extractPromptText(body.parts, { includeSynthetic: false });
      const visibleText = authoredText || text;

      // Capture liveness *before* this call marks busy. This invocation's own
      // status busy must not steer/followUp an idle first send.
      // Only the child run / this host turn is "live". Leftover status=busy
      // (adapter jsonl attach, false-idle) must not skip the user insert.
      const alreadyLive = sessionIsLive(record) || record.turnActive === true;

      // First-send bind can take longer than the user bubble. Mark busy now so
      // a targeted reload 409s before `piSession` exists or starts streaming.
      record.turnActive = true;
      const hadOpenPromptGate = Boolean(record.promptStarted) && !record.promptStarted.settled;
      const promptStarted = ensurePromptStartedGate(record);
      record.status = { type: 'busy' };
      emit(record.directory, {
        id: createEventId(),
        type: 'session.status',
        properties: { sessionID, status: { type: 'busy' } },
      });

      const userMessageID = body.messageID || createMessageId();
      const userAgent = typeof body.agent === 'string' && body.agent.trim() ? body.agent : 'pi';
      const userParts = [];
      if (authoredText) {
        userParts.push({
          id: createPartId(),
          sessionID,
          messageID: userMessageID,
          type: 'text',
          text: authoredText,
        });
      }
      for (const part of Array.isArray(body.parts) ? body.parts : []) {
        if (!part || part.type !== 'text' || !part.synthetic) continue;
        const metadata = part.metadata && typeof part.metadata === 'object' && !Array.isArray(part.metadata)
          ? part.metadata
          : null;
        const contextPayload = metadata?.pichamberContext ?? metadata?.openchamberContext;
        if (!contextPayload || typeof contextPayload !== 'object' || typeof contextPayload.kind !== 'string') {
          continue;
        }
        if (typeof part.text !== 'string' || !part.text.trim()) continue;
        userParts.push({
          id: createPartId(),
          sessionID,
          messageID: userMessageID,
          type: 'text',
          text: part.text,
          synthetic: true,
          metadata,
        });
      }
      if (userParts.length === 0 && visibleText) {
        userParts.push({
          id: createPartId(),
          sessionID,
          messageID: userMessageID,
          type: 'text',
          text: visibleText,
        });
      }
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

      const images = extractPromptImages(body.parts);
      const promptOptions = {
        ...(images.length > 0 ? { images } : {}),
      };

      try {
        await ensureLiveRecord(record);
        // Keep setSessionModel off the live-turn hot path. Concurrent setModel
        // IPC snapshots used to clobber parent isStreaming mid-run.
        if (modelRef && !alreadyLive && !sessionIsLive(record)) {
          await this.setSessionModel(sessionID, modelRef);
        }
        if (requestedThinking && THINKING_LEVELS.includes(requestedThinking) && !alreadyLive) {
          try {
            await this.setSessionThinking(sessionID, requestedThinking);
          } catch {
            // Keep the session's current thinking when the pin is unsupported.
          }
        }
      } catch (error) {
        if (alreadyLive || sessionIsLive(record)) {
          logPromptAsyncFailure({
            sessionID,
            parentIsStreaming: Boolean(record.piSession?.isStreaming),
            childIsStreaming: Boolean(record.piSession?.isStreaming),
            delivery: body.delivery,
            messageID: userMessageID,
            error,
          });
          throw error;
        }
        record.turnActive = false;
        promptStarted.resolve();
        record.status = { type: 'idle' };
        emit(record.directory, {
          id: createEventId(),
          type: 'session.error',
          properties: { sessionID, error: { message: error?.message || String(error) } },
        });
        emit(record.directory, { id: createEventId(), type: 'session.idle', properties: { sessionID } });
        throw error;
      }

      const runtimeModel = resolveHostFallbackModel(record, body.model);
      if (runtimeModel) {
        record.translator?.setFallbackModel?.(runtimeModel);
      }

      // followUp skips insert; overlapping idle without delivery coalesces;
      // steer always inserts.
      const skipInsert = body.delivery === 'followUp'
        || (alreadyLive && !body.delivery);
      if (!skipInsert) {
        record.translator?.setUserMessage?.(userMessageID, {
          agent: userAgent,
          model: runtimeModel || body.model,
        });

        if (!record.messages.some((entry) => entry.info.id === userMessageID)) {
          record.messages.push({ info: userInfo, parts: userParts });
        }
        const persistedContextParts = userParts.filter((part) => {
          const metadata = part?.metadata;
          if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
          const context = metadata.pichamberContext ?? metadata.openchamberContext;
          return Boolean(context && typeof context === 'object' && typeof context.kind === 'string');
        });
        if (persistedContextParts.length > 0) {
          record.info.metadata = rememberUserContext(record.info.metadata, {
            messageID: userMessageID,
            authoredText: authoredText || '',
            parts: persistedContextParts.map((part) => ({
              text: part.text,
              metadata: part.metadata,
            })),
          });
          persistSessionMetadata(
            record.sessionManager || record.piSession?.sessionManager,
            record.info.metadata,
          );
        }
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
      }

      const delivery = body.delivery;
      const run = async () => {
        let queuedIntoLiveTurn = false;
        try {
          if (hadOpenPromptGate && !sessionIsLive(record) && !promptStarted.settled) {
            await promptStarted.promise;
          }
          // Do not treat this invocation's own busy stamp as a live child.
          const liveNow = sessionIsLive(record) || alreadyLive;
          ensureQuestionToolAdapted(record);
          const action = resolvePromptDelivery({
            delivery,
            isStreaming: Boolean(record.piSession?.isStreaming) || liveNow,
            statusType: liveNow ? 'busy' : 'idle',
          });
          const imageArg = images.length > 0 ? images : undefined;
          const markStarted = () => promptStarted.resolve();
          if (action === 'steer' && typeof record.piSession.steer === 'function') {
            markStarted();
            await record.piSession.steer(text, imageArg);
            queuedIntoLiveTurn = true;
            return;
          }
          if (action === 'followUp' && typeof record.piSession.followUp === 'function') {
            markStarted();
            await record.piSession.followUp(text, imageArg);
            queuedIntoLiveTurn = true;
            return;
          }
          if (action !== 'prompt' && typeof record.piSession.prompt === 'function') {
            markStarted();
            await record.piSession.prompt(text, {
              ...promptOptions,
              streamingBehavior: action === 'followUp' ? 'followUp' : 'steer',
            });
            queuedIntoLiveTurn = true;
            return;
          }
          markStarted();
          // Never call bare prompt() while the child (or this host turn) is live.
          if (liveNow) {
            await record.piSession.prompt(text, {
              ...promptOptions,
              streamingBehavior: action === 'followUp' ? 'followUp' : 'steer',
            });
            queuedIntoLiveTurn = true;
            return;
          }
          await record.piSession.prompt(text, promptOptions);
        } catch (error) {
          const parentIsStreaming = Boolean(record.piSession?.isStreaming);
          let childIsStreaming = parentIsStreaming;
          try {
            if (typeof record.piSession?.refreshSnapshot === 'function') {
              await record.piSession.refreshSnapshot();
              childIsStreaming = Boolean(record.piSession?.isStreaming);
            }
          } catch {
          }
          logPromptAsyncFailure({
            sessionID,
            parentIsStreaming,
            childIsStreaming,
            delivery,
            messageID: userMessageID,
            error,
          });
          const stillLive = sessionIsLive(record)
            || childIsStreaming
            || parentIsStreaming
            || alreadyLive;
          if (stillLive || isAgentAlreadyProcessingError(error)) {
            if (!skipInsert) rollbackFacadeUserMessage(emit, record, userMessageID);
            // Do not session.idle / settle a still-running child. A rejected
            // follow-up is not turn end.
            queuedIntoLiveTurn = stillLive || alreadyLive;
            return;
          }
          record.turnActive = false;
          record.status = { type: 'idle' };
          emit(record.directory, {
            id: createEventId(),
            type: 'session.error',
            properties: { sessionID, error: { message: error?.message || String(error) } },
          });
          emit(record.directory, { id: createEventId(), type: 'session.idle', properties: { sessionID } });
        } finally {
          promptStarted.resolve();
          if (!queuedIntoLiveTurn) settleRecordIfStuck(record);
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
        await record.piSession?.abort?.();
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
        record.pluginCommandReloads = undefined;
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
      skippedUserExtensions.clear();
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
      const record = await ensureLiveRecord(await ensureRecord(sessionID));
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

      const dispatchLiveSessionCommand = async (liveCommand) => {
        if (typeof record.piSession?.prompt !== 'function') {
          const error = new Error(`Command /${name} is not available on this session`);
          error.status = 500;
          throw error;
        }
        ensureQuestionToolAdapted(record);
        const invoke = liveCommandInvocation(liveCommand, name);
        const promptText = `/${[invoke, argument].filter(Boolean).join(' ')}`;
        let goalUserID = '';
        let goalInsertAt = record.messages.length;
        if (name === goalCommand || name === 'goal') {
          goalInsertAt = record.messages.length;
          goalUserID = appendFacadeUserMessage(emit, record, body, userText);
          record.translator?.setUserMessage?.(goalUserID, {
            agent: typeof body.agent === 'string' && body.agent.trim() ? body.agent : 'pi',
            model: body.model,
          });
          writePiGoalMarker(record, true);
          maybeApplyConversationTitle(record);
          emit(record.directory, {
            id: createEventId(),
            type: 'session.updated',
            properties: { info: record.info },
          });
        }
        await record.piSession.prompt(promptText);
        if (goalUserID) {
          placeGoalCommandUserMessage(emit, record, goalUserID, goalInsertAt);
          writePiGoalMarker(
            record,
            isGoalMutexHeld(readRecordEntries(record), readRecordDiskEntries(record)),
          );
          persistSessionMetadata(record.sessionManager, record.info.metadata);
          emit(record.directory, {
            id: createEventId(),
            type: 'session.updated',
            properties: { info: record.info },
          });
        }
        await refreshRecordCommands(record);
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
        const target = typeof argument === 'string' ? argument.trim() : '';
        if (target === 'xai') {
          return reply(
            'Open Settings → Providers → xAI and choose Sign in with SuperGrok or X Premium. Tokens stay in ~/.pi/agent/auth.json and Pi refreshes them.',
          );
        }
        return reply(
          'Pi authentication is managed in Settings → Providers and stored in ~/.pi/agent. Interactive /login is not run in this desktop UI.',
        );
      }

      if (name === 'xai-usage') {
        if (!isXaiSlotActive(this.getFeaturePlugins())) {
          const error = new Error('Command /xai-usage is not available on this session');
          error.status = 404;
          throw error;
        }
        if (await ensureLivePluginCommand(record, name)) {
          return dispatchLiveSessionCommand(findLiveSessionCommand(record.piSession, name));
        }
        return reply(
          'Grok usage is shown in Work Status and Settings → Providers when the Grok Usage plugin is installed.',
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
        if (isPlanMutexHeld(readRecordPlan(record))) {
          const error = new Error('Plan mode is active. Exit Plan before starting a Goal.');
          error.status = 409;
          throw error;
        }
        const liveGoal = findLiveSessionCommand(record.piSession, name);
        if (liveGoal) {
          return dispatchLiveSessionCommand(liveGoal);
        }
        if (!isPluginSlotOn(this.getFeaturePlugins(), 'goal')) {
          const error = new Error(`Command /${name} is not available on this session`);
          error.status = 404;
          throw error;
        }
        if (!await ensureLivePluginCommand(record, name)) {
          const error = new Error(`Command /${name} is not available on this session`);
          error.status = 404;
          throw error;
        }
        return dispatchLiveSessionCommand(findLiveSessionCommand(record.piSession, name));
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
        if (!await ensureLivePluginCommand(record, name)) {
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
                  await record.piSession?.abort?.();
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

      if (name === 'plan') {
        const livePlan = findLiveSessionCommand(record.piSession, name);
        if (livePlan) {
          return dispatchLiveSessionCommand(livePlan);
        }
        if (isPluginSlotOn(this.getFeaturePlugins(), 'plan')) {
          if (await ensureLivePluginCommand(record, name)) {
            return dispatchLiveSessionCommand(findLiveSessionCommand(record.piSession, name));
          }
          const error = new Error('Command /plan is not available on this session');
          error.status = 404;
          throw error;
        }
      }

      const liveCommand = findLiveSessionCommand(record.piSession, name);
      if (liveCommand && isExtensionCommandSource(liveCommand.source)) {
        return dispatchLiveSessionCommand(liveCommand);
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
        return dispatchLiveSessionCommand(liveCommand);
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
      const record = await ensureLiveRecord(await ensureRecord(sessionID));
      const { action, model } = parseSessionPlanAction(body);
      await refreshRecordCommands(record);
      // Compaction and resume still need a quiet session (reload). Start/exit
      // with a live `/plan` only prompt; do not 409 on a stale isStreaming or
      // leftover busy after Goal, shell bind, or an ordinary send already finished.
      const needsReloadGate = Boolean(record.piSession?.isCompacting)
        || action === 'resume'
        || !findLiveSessionCommand(record.piSession, 'plan');
      const blocked = needsReloadGate ? sessionBlocksPiReload(record) : null;
      if (blocked) {
        const error = new Error(blocked);
        error.status = 409;
        throw error;
      }

      if (action === 'start' && isGoalMutexHeld(readRecordEntries(record), readRecordDiskEntries(record))) {
        const error = new Error('A Goal is active. Finish or stop it before starting Plan.');
        error.status = 409;
        throw error;
      }

      if (action === 'resume') {
        const current = resolvePlanModeState(
          typeof record.piSession?.getPlanModeState === 'function'
            ? record.piSession.getPlanModeState()
            : null,
          readRecordEntries(record),
          readRecordDiskEntries(record),
        );
        const next = resumeSavedPlanState(current);
        if (!next) {
          const error = new Error('No saved plan to resume');
          error.status = 409;
          throw error;
        }
        await persistRecordPlanState(record, next);
        await this.reload({ sessionID: record.id });
        const reloaded = await ensureRecord(record.id);
        const plan = readRecordPlan(reloaded);
        emitPlanUpdated(reloaded, plan);
        return plan;
      }

      if (action === 'implement' && model) {
        await this.setSessionModel(sessionID, model);
      }

      // View Plan Build/Save/Discard must settle the live plan-ready select.
      // Prompting `/plan implement` while that menu is open leaves the card
      // unchanged (a second Build). Answering "Implement here" is the plugin
      // path and starts implementation in this session.
      if (settlePlanReadyPrompt(
        record.extensionUI?.list?.() || [],
        (id, value) => record.extensionUI?.reply?.(id, value),
        action,
      )) {
        await new Promise((resolve) => setImmediate(resolve));
        await refreshRecordCommands(record);
        const plan = readRecordPlan(record);
        emitPlanUpdated(record, plan);
        return plan;
      }

      try {
        await this.runCommand(sessionID, {
          command: 'plan',
          arguments: action === 'exit' ? 'exit' : action,
        });
      } catch (error) {
        // Leftover bind streaming can throw from `/plan start`. Persist Plan
        // so GET is not `off` for the first user prompt. Missing `/plan` 404
        // and a saved-plan 409 must still reject.
        if (action === 'start' && isLeftoverPlanStartStreamError(error)) {
          const current = typeof record.piSession?.getPlanModeState === 'function'
            ? record.piSession.getPlanModeState()
            : restoreSessionPlanState(
              typeof record.sessionManager?.getEntries === 'function'
                ? record.sessionManager.getEntries()
                : [],
            );
          if (!(current?.savedPlan && !current?.enabled)) {
            await persistRecordPlanState(record, applyMockPlanCommand(
              current && typeof current === 'object' ? current : { enabled: false, awaitingAction: false },
              'start',
            ));
            const persisted = readRecordPlan(record);
            if (persisted.status === 'active') {
              emitPlanUpdated(record, persisted);
              return persisted;
            }
          }
        }
        throw error;
      }
      await refreshRecordCommands(record);
      const plan = readRecordPlan(record);
      emitPlanUpdated(record, plan);
      if (action === 'start' && plan.status === 'off') {
        const error = new Error('Plan mode did not start');
        error.status = 500;
        throw error;
      }
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
      const status = await getPiUpgradeStatus({
        env: options.env,
        fetchImpl: options.fetchImpl,
      });
      if (status?.upgrade?.supported !== true) {
        throw createPiUpgradeUnsupportedError();
      }
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
      const reload = await this.reloadIdleSessions();
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
      let manager;
      if (typeof createPackageManager === 'function') {
        manager = await createPackageManager({
          cwd: defaultDirectory,
          home,
          agentDir: resolveAgentDir(),
        });
      } else if (mock) {
        manager = createSettingsJsonPackageManager({ home });
      } else {
        manager = await createSdkPackageManager({
          cwd: defaultDirectory,
          home,
          loadSdk: loadPiSdk,
        });
      }
      return isolateUserNativesInElectron
        ? wrapPackageManagerWithElectronNativeTree(manager, electronTreeContext(defaultDirectory))
        : manager;
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
          record.pluginCommandReloads = undefined;
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
      const source = slot === 'xai'
        ? DEFAULT_FEATURE_PLUGIN_SOURCES.xai
        : (typeof body.source === 'string' && body.source.trim()
          ? body.source.trim()
          : current[slot].source);
      if (!source) {
        const error = new Error('Package source is required');
        error.status = 400;
        throw error;
      }
      const manager = await this.resolveFeaturePackageManager();
      const persist = typeof manager.installAndPersist === 'function'
        ? manager.installAndPersist.bind(manager)
        : typeof manager.install === 'function'
          ? manager.install.bind(manager)
          : null;
      if (!persist) {
        const error = new Error('Pi package install is unavailable');
        error.status = 503;
        throw error;
      }
      await persist(source);
      if (slot === 'xai' && typeof manager.removeAndPersist === 'function') {
        await manager.removeAndPersist(XAI_CONFLICTING_OAUTH_SOURCE).catch(() => undefined);
      }
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
      if (slot === 'xai') {
        await manager.removeAndPersist(XAI_CONFLICTING_OAUTH_SOURCE).catch(() => undefined);
      }
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
    async getSessionThinking(sessionID) {
      const record = await ensureRecord(sessionID);
      const entries = typeof record.sessionManager?.getEntries === 'function'
        ? record.sessionManager.getEntries()
        : [];
      applySessionRuntimeFromEntries(record.piSession, entries);
      const snapshot = readSessionThinking(record.piSession);
      const fromEntries = lastThinkingLevelChangeFromEntries(entries);
      let available = snapshot.available;
      try {
        const runtime = await ensureModelRuntime();
        const models = runtime && typeof runtime.getAvailable === 'function'
          ? await runtime.getAvailable()
          : [];
        const catalogModel = findRuntimeModel(models, lastModelChangeFromEntries(entries));
        const catalog = await readThinkingLevelsFromModel(catalogModel);
        if (catalog.length > 0) available = catalog;
        else available = widenThinkingAvailable(available, catalog);
      } catch {
      }
      return {
        ...snapshot,
        available,
        thinking: fromEntries || snapshot.thinking,
      };
    },
    async getSessionModel(sessionID) {
      const record = await ensureRecord(sessionID);
      const entries = typeof record.sessionManager?.getEntries === 'function'
        ? record.sessionManager.getEntries()
        : [];
      applySessionRuntimeFromEntries(record.piSession, entries);
      const usable = resolveUsableFacadeModel(
        lastModelChangeFromEntries(entries),
        record.piSession?.currentModel,
        lastModelChangeFromMessages(record.messages),
      );
      if (!usable) {
        return { model: null, providerID: null, modelID: null };
      }
      return {
        model: `${usable.providerID}/${usable.modelID}`,
        providerID: usable.providerID,
        modelID: usable.modelID,
      };
    },
    async setSessionThinking(sessionID, level) {
      const record = await ensureLiveRecord(await ensureRecord(sessionID));
      if (typeof record.piSession?.setThinkingLevel !== "function") {
        return { applied: false, ...readSessionThinking(record.piSession), thinking: level };
      }
      const entries = typeof record.sessionManager?.getEntries === 'function'
        ? record.sessionManager.getEntries()
        : [];
      applySessionRuntimeFromEntries(record.piSession, entries);
      const snapshot = readSessionThinking(record.piSession);
      let available = snapshot.available;
      let catalogModel = null;
      if (isNarrowThinkingAvailable(available)) {
        try {
          const runtime = await ensureModelRuntime();
          const models = runtime && typeof runtime.getAvailable === 'function'
            ? await runtime.getAvailable()
            : [];
          catalogModel = findRuntimeModel(models, lastModelChangeFromEntries(entries));
          available = widenThinkingAvailable(available, await readThinkingLevelsFromModel(catalogModel));
          if (catalogModel && typeof record.piSession.setModel === 'function') {
            try {
              const applied = record.piSession.setModel(catalogModel);
              if (applied && typeof applied.then === 'function') await applied;
            } catch {
            }
          }
        } catch {
        }
      }
      let next = THINKING_LEVELS.includes(level) ? level : null;
      if (available.length > 0) {
        if (!next || !available.includes(next)) {
          next = available.includes("medium") ? "medium" : available[0];
        }
      }
      if (!next) {
        const error = new Error("Invalid thinking level");
        error.status = 400;
        throw error;
      }
      record.piSession.setThinkingLevel(next);
      return { applied: true, thinking: next, available };
    },
    async setSessionModel(sessionID, modelRef) {
      const record = await ensureLiveRecord(await ensureRecord(sessionID));
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
      const record = await ensureLiveRecord(getRecord(sessionID));
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
        markRecordDisposed(record);
        try {
          record.extensionUI?.dispose?.();
          record.unsubscribe?.();
          record.piSession?.dispose?.();
        } catch {
        }
      }
      liveBindings.clear();
      sessions.clear();
      sessionTodos.clear();
      skippedUserExtensions.clear();
    },
  };
};
