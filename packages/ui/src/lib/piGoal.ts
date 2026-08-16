import type { FeaturePluginsPayload } from '@/components/sections/feature-plugins/featurePlugins';

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
  | { ok: false; reason: 'failed'; command: string; status?: number };

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

export function buildPiGoalStartCommand(command: string, objective: string): PiGoalStartCommand | { error: 'empty' } {
  const name = command.trim().replace(/^\//, '');
  const argument = objective.trim();
  if (!name || !argument) return { error: 'empty' };
  return { command: name, arguments: argument };
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
    return { ok: false, reason: 'failed', command: built.command, status };
  }
}
