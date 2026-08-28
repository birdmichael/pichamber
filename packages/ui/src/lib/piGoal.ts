import type { FeaturePluginsPayload } from '@/components/sections/feature-plugins/featurePlugins';
import { ROUTE_PARAMS } from '@/lib/router/types';

const DEFAULT_GOAL_COMMAND = 'goal';

export type PiGoalStartRequest = {
  sessionID: string | null | undefined;
  command: string;
  objective: string;
};

export type PiGoalStartCommand = {
  command: string;
  arguments: string;
};

export type PiGoalStartResult =
  | { ok: true; command: string; arguments: string }
  | { ok: false; reason: 'empty' }
  | { ok: false; reason: 'no-session' }
  | { ok: false; reason: 'missing-command'; command: string }
  | { ok: false; reason: 'plan-mutex'; command: string; status?: number }
  | { ok: false; reason: 'failed'; command: string; status?: number };

export type PiGoalSessionResolution =
  | { ok: true; sessionID: string; minted: boolean }
  | { ok: false; reason: 'no-session' };

export function isPiGoalPluginAvailable(payload: FeaturePluginsPayload | null | undefined): boolean {
  return Boolean(payload?.slots.goal.installed && payload.slots.goal.enabled);
}

export function isPiGoalComposerButtonVisible(input: {
  isPiKernel: boolean;
  payload: FeaturePluginsPayload | null | undefined;
}): boolean {
  return input.isPiKernel && isPiGoalPluginAvailable(input.payload);
}

export function getPiGoalCommand(payload: FeaturePluginsPayload | null | undefined): string {
  const command = payload?.slots.goal.command?.trim().replace(/^\//, '');
  return command || DEFAULT_GOAL_COMMAND;
}

export function canSubmitPiGoalObjective(objective: string): boolean {
  return objective.trim().length > 0;
}

/** Draft Plan chip or a live session already in Plan. Do not mint or send /goal. */
export function isPiGoalBlockedByPlan(input: {
  draftPlanSelected?: boolean;
  planStatus?: 'off' | 'active' | 'ready' | 'saved' | 'implementing' | null;
}): boolean {
  if (input.draftPlanSelected === true) return true;
  return input.planStatus === 'active' || input.planStatus === 'ready';
}

const pickSessionID = (value?: string | null): string => (
  typeof value === 'string' ? value.trim() : ''
);

export function readPiGoalRouteSessionID(search: string | null | undefined): string {
  const raw = typeof search === 'string' ? search : '';
  const query = raw.startsWith('?') ? raw.slice(1) : raw;
  return pickSessionID(new URLSearchParams(query).get(ROUTE_PARAMS.SESSION));
}

export function resolvePiGoalDirectory(input: {
  sessionDirectory?: string | null;
  lastActiveDirectory?: string | null;
  composerDirectory?: string | null;
}): string | null {
  return pickSessionID(input.sessionDirectory)
    || pickSessionID(input.lastActiveDirectory)
    || pickSessionID(input.composerDirectory)
    || null;
}

export function resolvePiGoalTargetSession(input: {
  sessionID?: string | null;
  currentSessionID?: string | null;
  routeSessionID?: string | null;
  lastActiveSessionID?: string | null;
  mintedSessionID?: string | null;
}): string {
  return pickSessionID(input.currentSessionID)
    || pickSessionID(input.sessionID)
    || pickSessionID(input.routeSessionID)
    || pickSessionID(input.lastActiveSessionID)
    || pickSessionID(input.mintedSessionID);
}

const PI_GOAL_USER_TEXT = /^\/goal(?::\d+)?\s+(.+)$/is;
const PI_GOAL_COMPLETE_TEXT = /^goal complete\b/i;

export function isPiGoalSystemPreamble(text: string | null | undefined): boolean {
  return /^Goal mode is active\./i.test(typeof text === 'string' ? text.trim() : '');
}

function isPiGoalCompleteText(text: string | null | undefined): boolean {
  return PI_GOAL_COMPLETE_TEXT.test(typeof text === 'string' ? text : '');
}

const objectiveFromUserText = (text: string): string | null => {
  const match = text.trim().match(PI_GOAL_USER_TEXT);
  return match?.[1]?.trim() || null;
};

const textFromParts = (parts: Array<{ type?: string; text?: string }> | null | undefined): string => (
  (parts || [])
    .map((part) => (part?.type === 'text' && typeof part.text === 'string' ? part.text : ''))
    .join('')
    .trim()
);

const toolOutputFromPart = (part: {
  type?: string;
  output?: unknown;
  state?: { output?: unknown };
} | null | undefined): string => {
  if (part?.type !== 'tool') return '';
  const output = part.state && typeof part.state === 'object'
    ? part.state.output
    : part.output;
  return typeof output === 'string' ? output : '';
};

const completeTextFromParts = (
  parts: Array<{ type?: string; text?: string; output?: unknown; state?: { output?: unknown } }> | null | undefined,
): string => (
  (parts || [])
    .map((part) => {
      if (part?.type === 'text' && typeof part.text === 'string') return part.text;
      return toolOutputFromPart(part);
    })
    .join('\n')
    .trim()
);

export function readPiGoalObjectiveFromMessages(
  messages: Array<{
    role?: string;
    info?: { role?: string };
    parts?: Array<{ type?: string; text?: string }>;
  }> | null | undefined,
): string | null {
  if (!Array.isArray(messages)) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entry = messages[index];
    const role = entry?.info?.role || entry?.role;
    if (role !== 'user') continue;
    const objective = objectiveFromUserText(textFromParts(entry.parts));
    if (objective) return objective;
  }
  return null;
}

export function readPiGoalObjectiveFromSession(
  messages: Array<{ id?: string; role?: string }> | null | undefined,
  partsByMessageID: Record<string, Array<{ type?: string; text?: string }>> | null | undefined,
): string | null {
  if (!Array.isArray(messages)) return null;
  const parts = partsByMessageID && typeof partsByMessageID === 'object' ? partsByMessageID : {};
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'user' || typeof message.id !== 'string' || !message.id) continue;
    const objective = objectiveFromUserText(textFromParts(parts[message.id]));
    if (objective) return objective;
  }
  return null;
}

const lastGoalUserIndex = (
  messages: Array<{ id?: string; role?: string }> | null | undefined,
  parts: Record<string, Array<{ type?: string; text?: string }>>,
): number => {
  if (!Array.isArray(messages)) return -1;
  let lastGoalIndex = -1;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role !== 'user' || typeof message.id !== 'string' || !message.id) continue;
    if (objectiveFromUserText(textFromParts(parts[message.id]))) lastGoalIndex = index;
  }
  return lastGoalIndex;
};

const hasGoalCompleteText = (
  messages: Array<{ id?: string; role?: string }> | null | undefined,
  parts: Record<string, Array<{ type?: string; text?: string }>>,
): boolean => {
  if (!Array.isArray(messages)) return false;
  return messages.some((message) => (
    message?.role === 'assistant'
    && typeof message.id === 'string'
    && message.id
    && isPiGoalCompleteText(completeTextFromParts(parts[message.id]))
  ));
};

const isExplicitInactivePiGoalMarker = (session: { metadata?: unknown } | null | undefined): boolean => {
  const metadata = session?.metadata;
  if (!metadata || typeof metadata !== 'object') return false;
  const namespace = (metadata as { pichamber?: unknown }).pichamber;
  if (!namespace || typeof namespace !== 'object') return false;
  const piGoal = (namespace as { piGoal?: unknown }).piGoal;
  return Boolean(piGoal && typeof piGoal === 'object' && (piGoal as { active?: unknown }).active === false);
};

export function isPiGoalComposerRowActive(
  messages: Array<{ id?: string; role?: string }> | null | undefined,
  partsByMessageID: Record<string, Array<{ type?: string; text?: string; output?: unknown; state?: { output?: unknown } }>> | null | undefined,
  session?: { metadata?: unknown } | null,
): boolean {
  if (!readPiGoalObjectiveFromSession(messages, partsByMessageID)) return false;
  if (isExplicitInactivePiGoalMarker(session)) return false;
  if (!Array.isArray(messages)) return false;
  const parts = partsByMessageID && typeof partsByMessageID === 'object' ? partsByMessageID : {};
  const lastGoalIndex = lastGoalUserIndex(messages, parts);
  if (lastGoalIndex < 0) return false;
  const laterUser = messages.slice(lastGoalIndex + 1).some((message) => message?.role === 'user');
  if (!laterUser && hasGoalCompleteText(messages, parts)) return false;
  for (let index = lastGoalIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role !== 'assistant' || typeof message.id !== 'string' || !message.id) continue;
    if (isPiGoalCompleteText(completeTextFromParts(parts[message.id]))) return false;
  }
  return true;
}

/** Hide leftover OpenChamber recap/suggestion after a /goal turn. */
export function isPiGoalSessionAssistHidden(
  messages: Array<{ id?: string; role?: string }> | null | undefined,
  partsByMessageID: Record<string, Array<{ type?: string; text?: string }>> | null | undefined,
): boolean {
  if (!Array.isArray(messages)) return false;
  const parts = partsByMessageID && typeof partsByMessageID === 'object' ? partsByMessageID : {};
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'user' || typeof message.id !== 'string' || !message.id) continue;
    return Boolean(objectiveFromUserText(textFromParts(parts[message.id])));
  }
  return false;
}

export function sessionHasPiGoalMarker(session: { metadata?: unknown } | null | undefined): boolean {
  const metadata = session?.metadata;
  if (!metadata || typeof metadata !== 'object') return false;
  const namespace = (metadata as { pichamber?: unknown }).pichamber;
  if (!namespace || typeof namespace !== 'object') return false;
  const piGoal = (namespace as { piGoal?: unknown }).piGoal;
  if (piGoal === true) return true;
  if (!piGoal || typeof piGoal !== 'object') return false;
  return (piGoal as { active?: unknown }).active === true;
}

export async function resolvePiGoalSession(input: {
  sessionID: string | null | undefined;
  currentSessionID?: string | null | undefined;
  routeSessionID?: string | null | undefined;
  lastActiveSessionID?: string | null | undefined;
  draftOpen?: boolean;
  createSession?: () => Promise<{ id: string } | null | undefined>;
}): Promise<PiGoalSessionResolution> {
  const sessionID = resolvePiGoalTargetSession({
    sessionID: input.sessionID,
    currentSessionID: input.currentSessionID,
    routeSessionID: input.routeSessionID,
    lastActiveSessionID: input.lastActiveSessionID,
  });
  if (sessionID) return { ok: true, sessionID, minted: false };
  if (!input.draftOpen || typeof input.createSession !== 'function') {
    return { ok: false, reason: 'no-session' };
  }
  const created = await input.createSession();
  const mintedID = typeof created?.id === 'string' ? created.id.trim() : '';
  if (!mintedID) return { ok: false, reason: 'no-session' };
  return { ok: true, sessionID: mintedID, minted: true };
}

export function buildPiGoalStartCommand(command: string, objective: string): PiGoalStartCommand | { error: 'empty' } {
  const name = command.trim().replace(/^\//, '');
  const argument = objective.trim();
  if (!name || !argument) return { error: 'empty' };
  return { command: name, arguments: argument };
}

export type PiGoalDialogSubmitResult =
  | { ok: true; sessionID: string; directory: string | null }
  | {
    ok: false;
    reason: 'empty' | 'no-session' | 'missing-command' | 'plan-mutex' | 'failed';
    command?: string;
    sessionID?: string;
    directory?: string | null;
  };

/** Mint if needed, send /goal, and only then report success so the dialog can close. */
export async function submitPiGoalFromDialog(input: {
  sessionID: string | null | undefined;
  currentSessionID?: string | null | undefined;
  routeSessionID?: string | null | undefined;
  lastActiveSessionID?: string | null | undefined;
  draftOpen?: boolean;
  draftPlanSelected?: boolean;
  planStatus?: 'off' | 'active' | 'ready' | 'saved' | 'implementing' | null;
  directory?: string | null;
  command: string;
  objective: string;
  createSession: () => Promise<{ id: string; directory?: string | null } | null | undefined>;
  sendCommand: (params: {
    id: string;
    command: string;
    arguments: string;
    directory: string | null;
  }) => Promise<unknown>;
}): Promise<PiGoalDialogSubmitResult> {
  const built = buildPiGoalStartCommand(input.command, input.objective);
  if ('error' in built) return { ok: false, reason: 'empty' };
  if (isPiGoalBlockedByPlan({
    draftPlanSelected: input.draftPlanSelected,
    planStatus: input.planStatus,
  })) {
    return { ok: false, reason: 'plan-mutex' };
  }

  let mintedDirectory = input.directory ?? null;
  const resolved = await resolvePiGoalSession({
    sessionID: input.sessionID,
    currentSessionID: input.currentSessionID,
    routeSessionID: input.routeSessionID,
    lastActiveSessionID: input.lastActiveSessionID,
    draftOpen: input.draftOpen,
    createSession: async () => {
      const created = await input.createSession();
      if (!created?.id) return null;
      mintedDirectory = created.directory ?? input.directory ?? null;
      return created;
    },
  });
  if (!resolved.ok) return { ok: false, reason: 'no-session' };

  const result = await startPiGoalCommand({
    request: {
      sessionID: resolved.sessionID,
      command: input.command,
      objective: input.objective,
    },
    sendCommand: async (params) => {
      await input.sendCommand({
        ...params,
        directory: mintedDirectory,
      });
    },
  });
  if (result.ok) {
    return { ok: true, sessionID: resolved.sessionID, directory: mintedDirectory };
  }
  if (result.reason === 'empty') return { ok: false, reason: 'empty' };
  if (result.reason === 'no-session') return { ok: false, reason: 'no-session' };
  if (result.reason === 'missing-command') {
    return {
      ok: false,
      reason: 'missing-command',
      command: result.command,
      sessionID: resolved.sessionID,
      directory: mintedDirectory,
    };
  }
  if (result.reason === 'plan-mutex') {
    return {
      ok: false,
      reason: 'plan-mutex',
      command: result.command,
      sessionID: resolved.sessionID,
      directory: mintedDirectory,
    };
  }
  return {
    ok: false,
    reason: 'failed',
    command: result.command,
    sessionID: resolved.sessionID,
    directory: mintedDirectory,
  };
}

export async function startPiGoalCommand(input: {
  request: PiGoalStartRequest;
  sendCommand: (params: { id: string; command: string; arguments: string }) => Promise<unknown>;
  sendMessage?: (params: { id: string; text: string }) => Promise<unknown>;
}): Promise<PiGoalStartResult> {
  const sessionID = typeof input.request.sessionID === 'string' ? input.request.sessionID.trim() : '';
  if (!sessionID) return { ok: false, reason: 'no-session' };

  const built = buildPiGoalStartCommand(input.request.command, input.request.objective);
  if ('error' in built) return { ok: false, reason: 'empty' };

  try {
    await input.sendCommand({
      id: sessionID,
      command: built.command,
      arguments: built.arguments,
    });
    return { ok: true, command: built.command, arguments: built.arguments };
  } catch (error) {
    const status = typeof (error as { status?: unknown })?.status === 'number'
      ? (error as { status: number }).status
      : undefined;
    const message = error instanceof Error ? error.message : '';
    if (status === 404 || /\(404\)/.test(message) || /not available on this session/i.test(message)) {
      return { ok: false, reason: 'missing-command', command: built.command };
    }
    if (status === 409 || /plan mode is active/i.test(message)) {
      return { ok: false, reason: 'plan-mutex', command: built.command, status };
    }
    return { ok: false, reason: 'failed', command: built.command, status };
  }
}
