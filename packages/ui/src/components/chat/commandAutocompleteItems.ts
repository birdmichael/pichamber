import { fuzzyMatch } from '@/lib/utils';

export interface CommandAutocompleteSearchItem {
  name: string;
  description?: string;
  searchAliases?: string[];
  isBuiltIn?: boolean;
  isSkill?: boolean;
}

function addSearchAliases<T extends CommandAutocompleteSearchItem>(winner: T, duplicate: T): T {
  const existingAliases = winner.searchAliases ?? [];
  const aliases = [
    ...existingAliases,
    ...(winner.name === duplicate.name ? [] : [duplicate.name]),
    ...(duplicate.description ? [duplicate.description] : []),
    ...(duplicate.searchAliases ?? []),
  ].filter((alias, index, values) => alias !== winner.description && values.indexOf(alias) === index);
  const unchanged = aliases.length === existingAliases.length
    && aliases.every((alias, index) => alias === existingAliases[index]);

  return unchanged ? winner : { ...winner, searchAliases: aliases };
}

/**
 * Precedence is local command, discovered skill, OpenCode skill-command, then
 * custom/plugin command. Identity matches session.command's case-sensitive lookup.
 */
export function mergeCommandAutocompleteItems<T extends CommandAutocompleteSearchItem>(
  builtIns: T[],
  commands: T[],
  skills: T[],
): T[] {
  const merged: T[] = [];
  const byName = new Map<string, { index: number; item: T; precedence: number }>();

  const addItems = (items: T[], getPrecedence: (item: T) => number) => {
    for (const item of items) {
      const precedence = getPrecedence(item);
      const identity = item.name;
      const existing = byName.get(identity);
      if (!existing) {
        byName.set(identity, { index: merged.length, item, precedence });
        merged.push(item);
        continue;
      }

      const winner = precedence > existing.precedence
        ? addSearchAliases(item, existing.item)
        : addSearchAliases(existing.item, item);
      merged[existing.index] = winner;
      byName.set(identity, {
        index: existing.index,
        item: winner,
        precedence: Math.max(existing.precedence, precedence),
      });
    }
  };

  addItems(builtIns, () => 3);
  addItems(commands, (item) => item.isBuiltIn ? 3 : item.isSkill ? 1 : 0);
  addItems(skills, () => 2);
  return merged;
}

export function commandMatchesSearch(command: CommandAutocompleteSearchItem, query: string): boolean {
  return fuzzyMatch(command.name, query)
    || Boolean(command.description && fuzzyMatch(command.description, query))
    || Boolean(command.searchAliases?.some((alias) => fuzzyMatch(alias, query)));
}

export interface PiSlashCommandItem {
  name: string;
  agent?: string;
  isOpenChamber?: boolean;
  isSkill?: boolean;
  /** False when a project skill is discovered but Pi will not inject it. */
  injected?: boolean;
}

/** Composer chips / Session Defaults own these; they are not invokable slash entries on Pi. */
const PI_CHIP_OWNED_SLASH_COMMANDS = new Set([
  'model', 'thinking',
]);

/** OpenChamber leftovers plus composer chips that already cover the same action. */
const PI_HIDDEN_SLASH_COMMANDS = new Set([
  'init', 'undo', 'redo', 'timeline', 'summary',
  'workspace-review', 'handoff-review', 'plan-feature', 'craft-goal',
  'schedule-task', 'catch-up', 'debug', 'weigh', 'explore',
  ...PI_CHIP_OWNED_SLASH_COMMANDS,
  'shell',
]);

/** Pi expands `/skill:name` in prompt/steer/followUp. Do not double-prefix. */
const PI_SKILL_SLASH_PREFIX = 'skill:';

export function toPiSkillSlashName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  return trimmed.startsWith(PI_SKILL_SLASH_PREFIX) ? trimmed : `${PI_SKILL_SLASH_PREFIX}${trimmed}`;
}

/** Settings Commands on Pi matches the slash popup for chip-owned builtins. Skills stay listed elsewhere. */
export function filterPiSettingsCommands<T extends { name: string }>(commands: T[], isPiKernel: boolean): T[] {
  if (!isPiKernel) return commands;
  return commands.filter((command) => !PI_CHIP_OWNED_SLASH_COMMANDS.has(command.name));
}

/**
 * Pi slash menu: builtins and custom prompts stay as `/name`. Installed,
 * injected skills become `/skill:name` so AgentSession expands them.
 * Untrusted project skills and leftover OpenChamber / chip commands stay out.
 */
export function filterPiSlashCommands<T extends PiSlashCommandItem>(commands: T[], isPiKernel: boolean): T[] {
  if (!isPiKernel) return commands;
  const kept: T[] = [];
  for (const command of commands) {
    if (command.isOpenChamber) continue;
    if (command.isSkill) {
      if (command.injected === false) continue;
      const slashName = toPiSkillSlashName(command.name);
      kept.push(slashName === command.name ? command : { ...command, name: slashName });
      continue;
    }
    if (PI_HIDDEN_SLASH_COMMANDS.has(command.name)) continue;
    const agent = typeof command.agent === 'string' ? command.agent.toLowerCase() : '';
    if (agent === 'openchamber' && command.name !== 'compact') continue;
    kept.push(command);
  }
  return kept;
}

/** Prefix match on `/skill:name` or the bare skill name (`/clack` → `skill:clack-…`). */
export function commandHasPiSlashPrefix(command: { name: string }, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const name = command.name.toLowerCase();
  if (name.startsWith(needle)) return true;
  if (name.startsWith(PI_SKILL_SLASH_PREFIX) && name.slice(PI_SKILL_SLASH_PREFIX.length).startsWith(needle)) {
    return true;
  }
  return false;
}

/** Pi slash search is name-only. Fuzzy-matching descriptions re-ranks the whole list. */
export function commandMatchesPiSlashQuery(command: { name: string }, query: string): boolean {
  return commandHasPiSlashPrefix(command, query);
}
