import type { PiThinkingLevel } from './piThinking';

export const BUILTIN_SUBAGENT_ROLES = ['scout', 'researcher', 'worker', 'reviewer', 'oracle', 'delegate'] as const;
export type SubagentRole = string;
export const SUBAGENT_THINKING_LEVELS: readonly PiThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export function getSubagentRoleNames(agents: ReadonlyArray<{ name?: string | null; mode?: string | null; hidden?: boolean }> = []): string[] {
  const names = new Set<string>(BUILTIN_SUBAGENT_ROLES);
  for (const agent of agents) {
    const name = typeof agent.name === 'string' ? agent.name.trim() : '';
    if (!name || agent.hidden || name === 'pi') continue;
    if (!agent.mode || agent.mode === 'subagent' || agent.mode === 'all') names.add(name);
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

export function buildSubagentRunArguments({ role, providerId, modelId, thinking, task }: { role: string; providerId: string; modelId: string; thinking: PiThinkingLevel; task: string }): string {
  return role + '[model=' + providerId + '/' + modelId + ':' + thinking + '] ' + JSON.stringify(task);
}
