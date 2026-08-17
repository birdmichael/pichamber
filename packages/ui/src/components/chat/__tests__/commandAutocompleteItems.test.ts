import { describe, expect, test } from 'bun:test';
import { PICHAMBER_STARTER_SLASH_COMMANDS } from '@/lib/draftStarters';
import {
  commandHasPiSlashPrefix,
  commandMatchesPiSlashQuery,
  commandMatchesSearch,
  ensureLiveFeatureSlashCommands,
  ensureLivePlanSlashCommand,
  filterPiSettingsCommands,
  filterPiSlashCommands,
  mergeCommandAutocompleteItems,
  resolveCommandAutocompleteKey,
  toPiSkillSlashName,
} from '../commandAutocompleteItems';

interface Item {
  name: string;
  source: 'openchamber' | 'opencode' | 'skill';
  description?: string;
  searchAliases?: string[];
  isBuiltIn?: boolean;
  isSkill?: boolean;
}

describe('mergeCommandAutocompleteItems', () => {
  test('retains the discovered skill and command search metadata for #1550', () => {
    const commands: Item[] = [{
      name: 'grill-with-docs',
      source: 'opencode',
      description: 'Plugin command description',
      isSkill: true,
    }];
    const skills: Item[] = [{
      name: 'grill-with-docs',
      source: 'skill',
      description: 'Canonical skill description',
      isSkill: true,
    }];

    const merged = mergeCommandAutocompleteItems([], commands, skills);

    expect(merged).toEqual([{
      ...skills[0],
      searchAliases: ['Plugin command description'],
    }]);
    expect(commandMatchesSearch(merged[0], 'plugin command')).toBe(true);
  });

  test('built-ins win collisions with commands and skills without losing search aliases', () => {
    const builtIn: Item = {
      name: 'summary',
      source: 'openchamber',
      description: 'Summarize this session',
      isBuiltIn: true,
    };
    const command: Item = {
      name: 'summary',
      source: 'opencode',
      description: 'Plugin session digest',
    };
    const skill: Item = {
      name: 'summary',
      source: 'skill',
      description: 'Skill session recap',
      isSkill: true,
    };

    expect(mergeCommandAutocompleteItems([builtIn], [command], [skill])).toEqual([{
      ...builtIn,
      searchAliases: ['Plugin session digest', 'Skill session recap'],
    }]);
  });

  test('OpenCode built-ins also win collisions with discovered skills', () => {
    const builtIn: Item = {
      name: 'review',
      source: 'opencode',
      description: 'Review workspace changes',
      isBuiltIn: true,
    };
    const skill: Item = {
      name: 'review',
      source: 'skill',
      description: 'Review skill',
      isSkill: true,
    };

    expect(mergeCommandAutocompleteItems([], [builtIn], [skill])).toEqual([{
      ...builtIn,
      searchAliases: ['Review skill'],
    }]);
  });

  test('deduplicates every pairwise source collision by executable precedence', () => {
    const builtIn: Item = { name: 'compact', source: 'openchamber', isBuiltIn: true };
    const command: Item = { name: 'compact', source: 'opencode' };
    const skill: Item = { name: 'compact', source: 'skill', isSkill: true };

    expect(mergeCommandAutocompleteItems([builtIn], [command], [])[0]).toBe(builtIn);
    expect(mergeCommandAutocompleteItems([builtIn], [], [skill])[0]).toBe(builtIn);
    expect(mergeCommandAutocompleteItems([], [command], [skill])[0]).toBe(skill);
  });

  test('OpenCode skill-commands win custom commands and yield to discovered skills', () => {
    const command: Item = { name: 'deploy', source: 'opencode', description: 'Custom deploy' };
    const skillCommand: Item = {
      name: 'deploy',
      source: 'opencode',
      description: 'OpenCode skill command',
      isSkill: true,
    };
    const skill: Item = {
      name: 'deploy',
      source: 'skill',
      description: 'Discovered deploy skill',
      isSkill: true,
    };

    expect(mergeCommandAutocompleteItems([], [command, skillCommand], [])).toEqual([{
      ...skillCommand,
      searchAliases: ['Custom deploy'],
    }]);
    expect(mergeCommandAutocompleteItems([], [command, skillCommand], [skill])).toEqual([{
      ...skill,
      searchAliases: ['OpenCode skill command', 'Custom deploy'],
    }]);
  });

  test('keeps a case-distinct command when the built-in is disabled', () => {
    const builtIn: Item = { name: 'init', source: 'openchamber', isBuiltIn: true };
    const command: Item = { name: 'Init', source: 'opencode', description: 'Custom init' };
    const merged = mergeCommandAutocompleteItems([builtIn], [command], []);

    expect(merged).toEqual([builtIn, command]);
    expect(merged.filter((item) => item.name !== 'init')).toEqual([command]);
  });

  test('keeps first-seen ordering and unrelated commands', () => {
    const builtIns: Item[] = [{ name: 'undo', source: 'openchamber' }];
    const commands: Item[] = [
      { name: 'test', source: 'opencode' },
      { name: 'deploy', source: 'opencode' },
    ];
    const skills: Item[] = [
      { name: 'deploy', source: 'skill', isSkill: true },
      { name: 'explain', source: 'skill', isSkill: true },
    ];

    const merged = mergeCommandAutocompleteItems(builtIns, commands, skills);

    expect(merged.map((item) => item.name)).toEqual(['undo', 'test', 'deploy', 'explain']);
    expect(merged[2]).toBe(skills[0]);
  });

  test('deduplicates repeated entries within each source without mutating inputs', () => {
    const first: Item = { name: 'test', source: 'opencode', description: 'First' };
    const duplicate: Item = { name: 'test', source: 'opencode', description: 'Second' };

    expect(mergeCommandAutocompleteItems([], [first, duplicate], [])).toEqual([{
      ...first,
      searchAliases: ['Second'],
    }]);
    expect(first.searchAliases).toBe(undefined);
  });

  test('handles empty inputs', () => {
    expect(mergeCommandAutocompleteItems([], [], [])).toEqual([]);
  });
});

describe('filterPiSlashCommands', () => {
  test('leaves OpenCode lists unchanged', () => {
    const commands = [
      { name: 'model', isSkill: false },
      { name: 'shell' },
      { name: 'catch-up', isOpenChamber: true },
    ];
    expect(filterPiSlashCommands(commands, false)).toEqual(commands);
  });

  test('keeps live PI /plan next to /plan-feature and does not hide it as OpenChamber', () => {
    const commands = [
      { name: 'plan', agent: 'pi' },
      { name: 'plan-feature', isOpenChamber: true },
      { name: 'compact', agent: 'openchamber' },
    ];
    expect(filterPiSlashCommands(commands, true).map((item) => item.name)).toEqual([
      'plan',
      'plan-feature',
      'compact',
    ]);
    expect(ensureLivePlanSlashCommand(
      filterPiSlashCommands([{ name: 'plan-feature', isOpenChamber: true }], true),
      { isPiKernel: true, planPluginAvailable: true },
    ).map((item) => item.name)).toEqual(['plan-feature', 'plan']);
    expect(ensureLiveFeatureSlashCommands(
      filterPiSlashCommands([{ name: 'plan-feature', isOpenChamber: true }], true),
      { isPiKernel: true, planPluginAvailable: true, subagentsPluginAvailable: true },
    ).map((item) => item.name)).toEqual(['plan-feature', 'plan', 'run']);
    expect(ensureLiveFeatureSlashCommands(
      filterPiSlashCommands([{ name: 'plan-feature', isOpenChamber: true }], true),
      { isPiKernel: true, planPluginAvailable: false, subagentsPluginAvailable: false },
    ).map((item) => item.name)).toEqual(['plan-feature']);
  });

  test('keeps Pichamber starters and injected skills, and still hides leftovers', () => {
    const commands = [
      { name: 'compact' },
      { name: 'reload' },
      { name: 'login' },
      { name: 'pr-review' },
      { name: 'model' },
      { name: 'thinking' },
      { name: 'shell' },
      { name: 'schedule-task', isOpenChamber: true },
      { name: 'catch-up', isOpenChamber: true },
      { name: 'plan-feature', isOpenChamber: true },
      { name: 'init', isOpenChamber: true },
      { name: 'handoff-review', isOpenChamber: true },
      { name: 'clack-cli-patterns', isSkill: true },
      { name: 'local-review', isSkill: true, injected: false },
      { name: 'skill:already-prefixed', isSkill: true },
    ];
    expect(filterPiSlashCommands(commands, true).map((item) => item.name)).toEqual([
      'compact',
      'login',
      'pr-review',
      'schedule-task',
      'catch-up',
      'plan-feature',
      'skill:clack-cli-patterns',
      'skill:already-prefixed',
    ]);
  });

  test('Pi slash menu keeps every empty-session Pichamber starter', () => {
    const commands = [...PICHAMBER_STARTER_SLASH_COMMANDS].map((name) => ({
      name,
      isOpenChamber: true,
    }));
    expect(filterPiSlashCommands(commands, true).map((item) => item.name).sort()).toEqual(
      [...PICHAMBER_STARTER_SLASH_COMMANDS].sort(),
    );
    expect(PICHAMBER_STARTER_SLASH_COMMANDS.has('catch-up')).toBe(true);
    expect(PICHAMBER_STARTER_SLASH_COMMANDS.has('plan-feature')).toBe(true);
  });

  test('does not treat a skill named model as the hidden chip command', () => {
    const commands = [
      { name: 'model' },
      { name: 'model', isSkill: true },
    ];
    expect(filterPiSlashCommands(commands, true).map((item) => item.name)).toEqual([
      'skill:model',
    ]);
  });
});

describe('toPiSkillSlashName', () => {
  test('prefixes a bare skill name once', () => {
    expect(toPiSkillSlashName('clack-cli-patterns')).toBe('skill:clack-cli-patterns');
    expect(toPiSkillSlashName('skill:clack-cli-patterns')).toBe('skill:clack-cli-patterns');
  });
});

describe('filterPiSettingsCommands', () => {
  test('leaves OpenCode lists unchanged', () => {
    const commands = [
      { name: 'model' },
      { name: 'thinking' },
      { name: 'ship' },
    ];
    expect(filterPiSettingsCommands(commands, false)).toEqual(commands);
  });

  test('hides chip-owned builtins and keeps custom prompts', () => {
    const commands = [
      { name: 'compact' },
      { name: 'reload' },
      { name: 'login' },
      { name: 'model' },
      { name: 'thinking' },
      { name: 'ship' },
    ];
    expect(filterPiSettingsCommands(commands, true).map((item) => item.name)).toEqual([
      'compact',
      'login',
      'ship',
    ]);
  });

  test('does not hide skills', () => {
    const commands = [
      { name: 'clack-cli-patterns', isSkill: true },
      { name: 'model' },
    ];
    expect(filterPiSettingsCommands(commands, true).map((item) => item.name)).toEqual([
      'clack-cli-patterns',
    ]);
  });
});

describe('commandMatchesPiSlashQuery', () => {
  test('matches a name prefix and ignores description text', () => {
    const compact = { name: 'compact', description: 'think about the session' };
    expect(commandMatchesPiSlashQuery(compact, 'co')).toBe(true);
    expect(commandMatchesPiSlashQuery(compact, 'th')).toBe(false);
    expect(commandMatchesPiSlashQuery(compact, 'catch')).toBe(false);
  });

  test('matches /skill, /skill:name, and the bare skill name', () => {
    const skill = { name: 'skill:clack-cli-patterns' };
    expect(commandMatchesPiSlashQuery(skill, 'skill')).toBe(true);
    expect(commandMatchesPiSlashQuery(skill, 'skill:clack')).toBe(true);
    expect(commandMatchesPiSlashQuery(skill, 'clack')).toBe(true);
    expect(commandHasPiSlashPrefix(skill, 'cli')).toBe(false);
    expect(commandMatchesPiSlashQuery(skill, 'compact')).toBe(false);
  });

  test('empty query keeps every remaining command', () => {
    expect(commandMatchesPiSlashQuery({ name: 'login' }, '')).toBe(true);
  });

  test('prefix /re does not suggest /reload', () => {
    const commands = filterPiSlashCommands([
      { name: 'compact' },
      { name: 'reload' },
      { name: 'login' },
      { name: 'review-pr' },
    ], true);
    expect(commands.map((item) => item.name)).toEqual(['compact', 'login', 'review-pr']);
    expect(commands.filter((item) => commandMatchesPiSlashQuery(item, 're')).map((item) => item.name)).toEqual([
      'review-pr',
    ]);
  });
});

describe('resolveCommandAutocompleteKey', () => {
  test('empty-list Enter closes and sends instead of no-op', () => {
    expect(resolveCommandAutocompleteKey('Enter', 0)).toEqual({
      type: 'close-and-send',
      consume: false,
    });
  });

  test('empty-list Escape still dismisses the popup', () => {
    expect(resolveCommandAutocompleteKey('Escape', 0)).toEqual({
      type: 'close',
      consume: true,
    });
  });

  test('empty-list arrows and Tab stay consumed no-ops', () => {
    expect(resolveCommandAutocompleteKey('ArrowDown', 0)).toEqual({ type: 'noop', consume: true });
    expect(resolveCommandAutocompleteKey('ArrowUp', 0)).toEqual({ type: 'noop', consume: true });
    expect(resolveCommandAutocompleteKey('Tab', 0)).toEqual({ type: 'noop', consume: true });
  });

  test('a matching list still selects, navigates, and dismisses', () => {
    expect(resolveCommandAutocompleteKey('Enter', 2)).toEqual({ type: 'select', consume: true });
    expect(resolveCommandAutocompleteKey('Tab', 2)).toEqual({ type: 'select', consume: true });
    expect(resolveCommandAutocompleteKey('ArrowDown', 2)).toEqual({
      type: 'navigate',
      direction: 'next',
      consume: true,
    });
    expect(resolveCommandAutocompleteKey('ArrowUp', 2)).toEqual({
      type: 'navigate',
      direction: 'previous',
      consume: true,
    });
    expect(resolveCommandAutocompleteKey('Escape', 2)).toEqual({ type: 'close', consume: true });
  });
});
