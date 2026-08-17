import { createWorktree as createWorktreeDefault, getWorktreeBootstrapStatus as getWorktreeBootstrapStatusDefault } from '../git/index.js';
import { expandSnippets } from '../opencode/snippets.js';
import { OpenChamberControlError } from '../openchamber-control/error.js';
import { THINKING_LEVELS } from './pi-resources.js';

const PI_PRIMARY_AGENT = 'pi';
const MIN_GOAL_TOKEN_BUDGET = 1_000;
const MAX_GOAL_TOKEN_BUDGET = 100_000_000;
const WORKTREE_BOOTSTRAP_TIMEOUT_MS = 60_000;
const WORKTREE_BOOTSTRAP_POLL_MS = 150;

const asNonEmptyString = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseModel = (value) => {
  const model = asNonEmptyString(value);
  if (!model) return null;
  const slashIndex = model.indexOf('/');
  if (slashIndex <= 0 || slashIndex === model.length - 1) {
    throw new OpenChamberControlError('model must be in provider/model format', 400);
  }
  return { providerID: model.slice(0, slashIndex), modelID: model.slice(slashIndex + 1) };
};

const providerModels = (provider) => {
  if (Array.isArray(provider?.models)) return provider.models;
  if (provider?.models && typeof provider.models === 'object') return Object.values(provider.models);
  return [];
};

const hasProviderModel = (providers, providerID, modelID) => (
  providers.some((provider) => provider?.id === providerID
    && providerModels(provider).some((model) => model?.id === modelID))
);

const resolveGoalInput = (payload, prompt) => {
  const enabled = payload?.goal === true;
  if (payload?.goalTokenBudget !== undefined && !enabled) {
    return { ok: false, error: 'goalTokenBudget requires goal' };
  }
  if (enabled && !prompt) {
    return { ok: false, error: 'prompt is required when goal is enabled' };
  }
  if (payload?.goalTokenBudget === undefined) {
    return { ok: true, enabled, tokenBudget: null };
  }
  const tokenBudget = payload.goalTokenBudget;
  if (!Number.isSafeInteger(tokenBudget)
    || tokenBudget < MIN_GOAL_TOKEN_BUDGET
    || tokenBudget > MAX_GOAL_TOKEN_BUDGET) {
    return { ok: false, error: `goalTokenBudget must be an integer from ${MIN_GOAL_TOKEN_BUDGET} to ${MAX_GOAL_TOKEN_BUDGET}` };
  }
  return { ok: true, enabled, tokenBudget };
};

const resolveWorktreeInput = (payload) => {
  if (!payload?.worktree) return null;
  if (typeof payload.worktree === 'string') {
    const name = asNonEmptyString(payload.worktree);
    return name ? { mode: 'new', name } : null;
  }
  if (typeof payload.worktree !== 'object') return null;
  const name = asNonEmptyString(payload.worktree.name);
  if (!name) return null;
  const branchName = asNonEmptyString(payload.worktree.branchName);
  const startRef = asNonEmptyString(payload.worktree.startRef);
  return {
    mode: 'new',
    name,
    ...(branchName ? { branchName } : {}),
    ...(startRef ? { startRef } : {}),
    ...(typeof payload.setUpstream === 'boolean' ? { setUpstream: payload.setUpstream } : {}),
  };
};

const isGoalSlotActive = (host) => {
  const slot = host?.getFeaturePlugins?.()?.slots?.goal;
  return Boolean(slot?.installed && slot?.enabled);
};

const goalCommandName = (host) => {
  const command = asNonEmptyString(host?.getFeaturePlugins?.()?.slots?.goal?.command);
  return command || 'goal';
};

const waitForWorktreeBootstrapReady = async ({ directory, getWorktreeBootstrapStatus, sleep }) => {
  const deadline = Date.now() + WORKTREE_BOOTSTRAP_TIMEOUT_MS;
  for (;;) {
    const status = await getWorktreeBootstrapStatus(directory);
    if (status?.status === 'failed') {
      throw new OpenChamberControlError(`Worktree bootstrap failed: ${status.error || 'unknown error'}`, 500);
    }
    const phase = status?.phase;
    if (status?.status === 'ready' || phase === 'git-ready' || phase === 'setup-ready') return;
    if (Date.now() >= deadline) {
      throw new OpenChamberControlError('Timed out waiting for the worktree bootstrap', 500);
    }
    await sleep(WORKTREE_BOOTSTRAP_POLL_MS);
  }
};

const listUserMessageIds = (messages) => new Set(
  (Array.isArray(messages) ? messages : [])
    .filter((entry) => entry?.info?.role === 'user' && asNonEmptyString(entry.info.id))
    .map((entry) => entry.info.id),
);

const latestCompletedAssistantMessageId = (messages) => {
  let latest = null;
  for (const entry of Array.isArray(messages) ? messages : []) {
    const info = entry?.info;
    if (info?.role !== 'assistant' || !Number.isFinite(info?.time?.completed)) continue;
    if (!latest || (info.time.created || 0) >= (latest.time?.created || 0)) latest = info;
  }
  return asNonEmptyString(latest?.id);
};

const readHostMessages = async (host, sessionID, directory) => {
  try {
    return host.getMessages(sessionID) || [];
  } catch {
    if (typeof host.ensureSession === 'function') {
      await host.ensureSession(sessionID, directory);
      return host.getMessages(sessionID) || [];
    }
    throw new OpenChamberControlError('sessionId is required', 400);
  }
};

const resolveDirectory = async ({ payload, readSettingsFromDiskMigrated, sanitizeProjects }) => {
  const projectID = asNonEmptyString(payload?.projectId) || asNonEmptyString(payload?.projectID);
  if (projectID) {
    const settings = await readSettingsFromDiskMigrated();
    const projects = sanitizeProjects(settings?.projects || []);
    const project = projects.find((entry) => entry.id === projectID) || null;
    if (!project?.path) {
      throw new OpenChamberControlError('Project not found', 404);
    }
    return { directory: project.path, projectId: projectID };
  }
  const directory = asNonEmptyString(payload?.directory);
  if (!directory) {
    throw new OpenChamberControlError('directory is required', 400);
  }
  return { directory };
};

const validatePiSelection = async ({ host, requestedModel, requestedAgent, requestedVariant }) => {
  const agent = asNonEmptyString(requestedAgent);
  if (agent && agent !== PI_PRIMARY_AGENT) {
    throw new OpenChamberControlError(`Unknown agent '${agent}'`, 400);
  }

  const variant = asNonEmptyString(requestedVariant);
  if (variant && !THINKING_LEVELS.includes(variant)) {
    throw new OpenChamberControlError(`Unknown variant '${variant}'`, 400);
  }

  if (!requestedModel) return;
  let providers = [];
  try {
    const catalog = typeof host.getProviders === 'function' ? await host.getProviders() : null;
    providers = Array.isArray(catalog?.providers) ? catalog.providers : [];
  } catch {
    return;
  }
  if (providers.length === 0) return;
  if (!hasProviderModel(providers, requestedModel.providerID, requestedModel.modelID)) {
    throw new OpenChamberControlError(
      `Unknown model '${requestedModel.providerID}/${requestedModel.modelID}'`,
      400,
    );
  }
};

const applySessionModel = async (host, sessionID, requestedModel) => {
  if (!requestedModel) {
    const defaults = typeof host.getDefaults === 'function' ? host.getDefaults() : null;
    const fallback = asNonEmptyString(defaults?.model);
    if (!fallback || typeof host.setSessionModel !== 'function') return fallback || null;
    try {
      const applied = await host.setSessionModel(sessionID, fallback);
      return asNonEmptyString(applied?.model) || fallback;
    } catch {
      return fallback;
    }
  }
  const ref = `${requestedModel.providerID}/${requestedModel.modelID}`;
  if (typeof host.setSessionModel !== 'function') return ref;
  const applied = await host.setSessionModel(sessionID, ref);
  return asNonEmptyString(applied?.model) || ref;
};

const applySessionThinking = async (host, sessionID, variant) => {
  const level = asNonEmptyString(variant);
  if (!level || typeof host.setSessionThinking !== 'function') return;
  await host.setSessionThinking(sessionID, level);
};

const observePromptDispatch = async (host, sessionID, directory, beforeIds) => {
  const after = await readHostMessages(host, sessionID, directory);
  return [...listUserMessageIds(after)].some((id) => !beforeIds.has(id));
};

const dispatchPrompt = async ({
  host,
  sessionID,
  directory,
  prompt,
  goalInput,
  requestedModel,
  requestedAgent,
  requestedVariant,
}) => {
  const modelRef = await applySessionModel(host, sessionID, requestedModel);
  await applySessionThinking(host, sessionID, requestedVariant);
  const expandedPrompt = expandSnippets(prompt, directory);
  const agent = asNonEmptyString(requestedAgent);

  if (goalInput.enabled) {
    if (!isGoalSlotActive(host)) {
      throw new OpenChamberControlError('Goal must be installed and enabled in Feature Plugins', 400);
    }
    await host.runCommand(sessionID, {
      command: goalCommandName(host),
      arguments: expandedPrompt,
    });
    return {
      model: modelRef ? parseModel(modelRef) : requestedModel,
      ...(agent ? { agent } : {}),
      ...(asNonEmptyString(requestedVariant) ? { variant: requestedVariant.trim() } : {}),
      promptDispatched: true,
      dispatchedAsCommand: true,
    };
  }

  const beforeIds = listUserMessageIds(await readHostMessages(host, sessionID, directory));
  try {
    await host.promptAsync(sessionID, {
      parts: [{ type: 'text', text: expandedPrompt }],
      ...(agent ? { agent } : {}),
      ...(modelRef ? { model: modelRef } : {}),
    });
  } catch (error) {
    return {
      model: modelRef ? parseModel(modelRef) : requestedModel,
      ...(agent ? { agent } : {}),
      ...(asNonEmptyString(requestedVariant) ? { variant: requestedVariant.trim() } : {}),
      promptDispatched: false,
      dispatchedAsCommand: false,
      promptError: error instanceof Error ? error.message : String(error),
    };
  }
  const landed = await observePromptDispatch(host, sessionID, directory, beforeIds);
  return {
    model: modelRef ? parseModel(modelRef) : requestedModel,
    ...(agent ? { agent } : {}),
    ...(asNonEmptyString(requestedVariant) ? { variant: requestedVariant.trim() } : {}),
    promptDispatched: landed,
    dispatchedAsCommand: false,
    ...(landed ? {} : { promptError: 'Pi accepted the prompt but it never appeared in the session' }),
  };
};

export const listPiModelPreferences = (host) => {
  const defaults = typeof host?.getDefaults === 'function' ? host.getDefaults() || {} : {};
  return {
    defaultModel: asNonEmptyString(defaults.model),
    defaultVariant: asNonEmptyString(defaults.thinking),
    defaultAgent: null,
    favoriteModels: Array.isArray(defaults.enabledModels) ? defaults.enabledModels : [],
    recentModels: [],
  };
};

export const createPichamberControlSessions = (dependencies = {}) => {
  const {
    readSettingsFromDiskMigrated,
    sanitizeProjects,
    createWorktree = createWorktreeDefault,
    getWorktreeBootstrapStatus = getWorktreeBootstrapStatusDefault,
    emitSessionCreatedEvent,
    sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
  } = dependencies;

  const create = async (host, payload = {}) => {
    const title = asNonEmptyString(payload.title);
    const prompt = asNonEmptyString(payload.prompt);
    const goalInput = resolveGoalInput(payload, prompt);
    if (!goalInput.ok) {
      throw new OpenChamberControlError(goalInput.error, 400);
    }
    if (goalInput.enabled && !isGoalSlotActive(host)) {
      throw new OpenChamberControlError('Goal must be installed and enabled in Feature Plugins', 400);
    }
    const requestedModel = parseModel(payload.model);
    const requestedAgent = asNonEmptyString(payload.agent);
    const requestedVariant = asNonEmptyString(payload.variant);
    await validatePiSelection({
      host,
      requestedModel,
      requestedAgent,
      requestedVariant,
    });

    const resolved = await resolveDirectory({
      payload,
      readSettingsFromDiskMigrated,
      sanitizeProjects,
    });
    const worktreeInput = resolveWorktreeInput(payload);
    if (payload?.worktree && !worktreeInput) {
      throw new OpenChamberControlError('worktree.name is required when worktree is provided', 400);
    }

    let worktree = null;
    let sessionDirectory = resolved.directory;
    if (worktreeInput) {
      worktree = await createWorktree(resolved.directory, worktreeInput);
      sessionDirectory = worktree.path;
      await waitForWorktreeBootstrapReady({
        directory: sessionDirectory,
        getWorktreeBootstrapStatus,
        sleep,
      });
    }

    if (typeof host.ready === 'function') {
      await host.ready();
    }
    const record = await host.createSession({
      directory: sessionDirectory,
      ...(title ? { title } : {}),
    });
    const sessionID = record?.id || record?.info?.id;
    if (!sessionID) {
      throw new OpenChamberControlError('failed to create session', 500);
    }

    let dispatch = {
      model: requestedModel,
      agent: requestedAgent,
      variant: requestedVariant,
      promptDispatched: false,
      dispatchedAsCommand: false,
    };
    if (prompt) {
      dispatch = await dispatchPrompt({
        host,
        sessionID,
        directory: sessionDirectory,
        prompt,
        goalInput,
        requestedModel,
        requestedAgent,
        requestedVariant,
      });
    } else {
      if (requestedModel) {
        await applySessionModel(host, sessionID, requestedModel);
      }
      if (requestedVariant) {
        await applySessionThinking(host, sessionID, requestedVariant);
      }
    }

    const result = {
      sessionId: sessionID,
      directory: sessionDirectory,
      ...(resolved.projectId ? { projectId: resolved.projectId } : {}),
      ...(title ? { title } : {}),
      ...(worktree ? { worktree } : {}),
      ...(prompt && dispatch.model ? { model: dispatch.model } : {}),
      ...(prompt && dispatch.agent ? { agent: dispatch.agent } : {}),
      ...(prompt && dispatch.variant ? { variant: dispatch.variant } : {}),
      promptDispatched: dispatch.promptDispatched,
      ...(dispatch.promptError ? { promptError: dispatch.promptError } : {}),
      dispatchedAsCommand: dispatch.dispatchedAsCommand,
      ...(goalInput.enabled ? { goalEnabled: true } : {}),
      ...(goalInput.tokenBudget ? { goalTokenBudget: goalInput.tokenBudget } : {}),
    };

    try {
      emitSessionCreatedEvent?.({
        sessionID,
        directory: sessionDirectory,
        ...(resolved.projectId ? { projectID: resolved.projectId } : {}),
        ...(title ? { title } : {}),
        ...(worktree ? { worktree } : {}),
        promptDispatched: dispatch.promptDispatched,
        dispatchedAsCommand: dispatch.dispatchedAsCommand,
        createdAt: Date.now(),
      });
    } catch {
    }

    return result;
  };

  const runExisting = async (host, action, sourceSessionId, payload = {}) => {
    const sourceSessionID = asNonEmptyString(sourceSessionId);
    if (!sourceSessionID) throw new OpenChamberControlError('sessionId is required', 400);
    const prompt = asNonEmptyString(payload.prompt);
    if (action === 'send' && !prompt) {
      throw new OpenChamberControlError('prompt is required', 400);
    }
    const goalInput = resolveGoalInput(payload, prompt);
    if (!goalInput.ok) throw new OpenChamberControlError(goalInput.error, 400);
    if (goalInput.enabled && !isGoalSlotActive(host)) {
      throw new OpenChamberControlError('Goal must be installed and enabled in Feature Plugins', 400);
    }
    const requestedModel = parseModel(payload.model);
    const requestedAgent = asNonEmptyString(payload.agent);
    const requestedVariant = asNonEmptyString(payload.variant);
    await validatePiSelection({
      host,
      requestedModel,
      requestedAgent,
      requestedVariant,
    });

    let directory = asNonEmptyString(payload.directory);
    if (!directory) {
      throw new OpenChamberControlError('directory is required', 400);
    }

    let targetSessionID = sourceSessionID;
    let targetTitle = null;
    if (action === 'fork') {
      const forked = await host.forkSession(sourceSessionID, asNonEmptyString(payload.messageId) || undefined);
      targetSessionID = forked?.id || forked?.info?.id;
      targetTitle = asNonEmptyString(forked?.info?.title) || asNonEmptyString(forked?.title);
      if (!targetSessionID) {
        throw new OpenChamberControlError('failed to fork session', 500);
      }
      directory = asNonEmptyString(forked?.directory) || directory;
    }

    const baselineAssistantMessageId = latestCompletedAssistantMessageId(
      await readHostMessages(host, targetSessionID, directory),
    );

    let dispatch = {
      model: requestedModel,
      agent: requestedAgent,
      variant: requestedVariant,
      promptDispatched: false,
      dispatchedAsCommand: false,
    };
    if (prompt) {
      dispatch = await dispatchPrompt({
        host,
        sessionID: targetSessionID,
        directory,
        prompt,
        goalInput,
        requestedModel,
        requestedAgent,
        requestedVariant,
      });
    }

    return {
      action,
      sessionId: targetSessionID,
      directory,
      ...(action === 'fork' ? { sourceSessionId: sourceSessionID } : {}),
      ...(targetTitle ? { title: targetTitle } : {}),
      ...(baselineAssistantMessageId ? { baselineAssistantMessageId } : {}),
      ...(dispatch.model ? { model: dispatch.model } : {}),
      ...(dispatch.agent ? { agent: dispatch.agent } : {}),
      ...(dispatch.variant ? { variant: dispatch.variant } : {}),
      promptDispatched: dispatch.promptDispatched,
      ...(dispatch.promptError ? { promptError: dispatch.promptError } : {}),
      dispatchedAsCommand: dispatch.dispatchedAsCommand,
      ...(goalInput.enabled ? { goalEnabled: true } : {}),
      ...(goalInput.tokenBudget ? { goalTokenBudget: goalInput.tokenBudget } : {}),
    };
  };

  return {
    create: (host, payload) => create(host, payload),
    send: (host, sessionID, payload) => runExisting(host, 'send', sessionID, payload),
    fork: (host, sessionID, payload) => runExisting(host, 'fork', sessionID, payload),
  };
};
