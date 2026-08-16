import { isPichamberStarterSlashCommand } from '@/lib/draftStarters';
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

/** OpenCode leftovers plus composer chips that already cover the same action. Reload is host-only. */
const PI_HIDDEN_SLASH_COMMANDS = new Set([
  'init', 'undo', 'redo', 'timeline', 'summary',
  'handoff-review',
  ...PI_CHIP_OWNED_SLASH_COMMANDS,
  'reload',
  'shell',
]);

/** Pi expands `/skill:name` in prompt/steer/followUp. Do not double-prefix. */
const PI_SKILL_SLASH_PREFIX = 'skill:';

export function toPiSkillSlashName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  return trimmed.startsWith(PI_SKILL_SLASH_PREFIX) ? trimmed : `${PI_SKILL_SLASH_PREFIX}${trimmed}`;
}

/** Settings Commands on Pi matches the slash popup for chip-owned and host-only builtins. Skills stay listed elsewhere. */
export function filterPiSettingsCommands<T extends { name: string }>(commands: T[], isPiKernel: boolean): T[] {
  if (!isPiKernel) return commands;
  return commands.filter((command) => (
    !PI_CHIP_OWNED_SLASH_COMMANDS.has(command.name)
    && command.name !== 'reload'
  ));
}

/**
 * Pi slash menu: builtins and custom prompts stay as `/name`. Installed,
 * injected skills become `/skill:name` so AgentSession expands them.
 * Untrusted project skills, OpenCode leftovers, and chip-owned commands stay
 * out. In-app Pichamber starters (`/catch-up`, `/plan-feature`, and the rest
 * of the empty-session chips) stay: they send magic prompts through the Pi
 * session host, not leftover OpenCode flows.
 */
export function filterPiSlashCommands<T extends PiSlashCommandItem>(commands: T[], isPiKernel: boolean): T[] {
  if (!isPiKernel) return commands;
  const kept: T[] = [];
  for (const command of commands) {
    if (command.isOpenChamber && !isPichamberStarterSlashCommand(command.name)) continue;
    if (command.isSkill) {
      if (command.injected === false) continue;
      const slashName = toPiSkillSlashName(command.name);
      kept.push(slashName === command.name ? command : { ...command, name: slashName });
      continue;
    }
    if (PI_HIDDEN_SLASH_COMMANDS.has(command.name)) continue;
    const agent = typeof command.agent === 'string' ? command.agent.toLowerCase() : '';
    if (agent === 'openchamber' && command.name !== 'compact' && command.name !== 'plan') continue;
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

/** Live PI `/plan` must stay visible next to `/plan-feature`, including empty drafts. */
export function ensureLivePlanSlashCommand<T extends PiSlashCommandItem>(
  commands: T[],
  options: { isPiKernel: boolean; planPluginAvailable: boolean; subagentsPluginAvailable?: boolean },
): T[] {
  return ensureLiveFeatureSlashCommands(commands, options);
}

/** Feature-plugin slashes that must appear before a live session lists them. */
export function ensureLiveFeatureSlashCommands<T extends PiSlashCommandItem>(
  commands: T[],
  options: {
    isPiKernel: boolean;
    planPluginAvailable: boolean;
    subagentsPluginAvailable?: boolean;
  },
): T[] {
  if (!options.isPiKernel) return commands;
  const next = [...commands];
  if (options.planPluginAvailable && !next.some((command) => command.name === 'plan')) {
    next.push({ name: 'plan', agent: 'pi' } as T);
  }
  if (options.subagentsPluginAvailable && !next.some((command) => command.name === 'run')) {
    next.push({ name: 'run', agent: 'pi' } as T);
  }
  return next;
}

/**
 * Slash-popup key contract. The composer routes Enter into the open popup;
 * an empty list must close and let that Enter send the typed text as chat.
 * Escape still dismisses. A non-empty list still selects or navigates.
 */
export type CommandAutocompleteKeyAction =
  | { type: 'close'; consume: true }
  | { type: 'close-and-send'; consume: false }
  | { type: 'navigate'; direction: 'next' | 'previous'; consume: true }
  | { type: 'select'; consume: true }
  | { type: 'noop'; consume: true };

export function resolveCommandAutocompleteKey(
  key: string,
  itemCount: number,
): CommandAutocompleteKeyAction {
  if (key === 'Escape') {
    return { type: 'close', consume: true };
  }

  if (itemCount === 0) {
    if (key === 'Enter') {
      return { type: 'close-and-send', consume: false };
    }
    return { type: 'noop', consume: true };
  }

  if (key === 'ArrowDown') {
    return { type: 'navigate', direction: 'next', consume: true };
  }
  if (key === 'ArrowUp') {
    return { type: 'navigate', direction: 'previous', consume: true };
  }
  if (key === 'Enter' || key === 'Tab') {
    return { type: 'select', consume: true };
  }
  return { type: 'noop', consume: true };
}
