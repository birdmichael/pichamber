import { describe, expect, test } from 'bun:test';
import {
  defaultNewSkillLocation,
  defaultSkillSource,
  getSkillCatalogInstallLocations,
  getSkillLocationOptions,
  locationPartsFrom,
  locationValueFrom,
  skillLocationLabelKey,
} from './skillLocations';

describe('skillLocations', () => {
  test('Pi kernel picker uses source pi, not a renamed opencode enum', () => {
    const options = getSkillLocationOptions(true);
    expect(options.map((option) => option.value)).toEqual([
      'user-pi',
      'project-pi',
      'user-agents',
      'project-agents',
    ]);
    expect(options.every((option) => option.source !== 'opencode')).toBe(true);
    expect(defaultSkillSource(true)).toBe('pi');
    expect(locationPartsFrom('user-pi')).toEqual({ scope: 'user', source: 'pi' });
    expect(locationPartsFrom('project-pi')).toEqual({ scope: 'project', source: 'pi' });
    expect(locationValueFrom('user', 'pi')).toBe('user-pi');
    expect(locationValueFrom('project', 'pi')).toBe('project-pi');
  });

  test('OpenCode kernel picker keeps leftover opencode location keys', () => {
    const options = getSkillLocationOptions(false);
    expect(options.map((option) => option.value)).toEqual([
      'user-opencode',
      'project-opencode',
      'user-agents',
      'project-agents',
    ]);
    expect(defaultSkillSource(false)).toBe('opencode');
    expect(locationValueFrom('user', 'opencode')).toBe('user-opencode');
    expect(locationValueFrom('project', 'opencode')).toBe('project-opencode');
  });

  test('leftover opencode source is not remapped to Pi location keys', () => {
    expect(locationValueFrom('user', 'opencode')).toBe('user-opencode');
    expect(locationValueFrom('project', 'opencode')).toBe('project-opencode');
    expect(locationPartsFrom('user-opencode').source).toBe('opencode');
  });

  test('Pi picker labels stay on userPi / projectPi / .agents keys', () => {
    const keys = getSkillLocationOptions(true).map((option) => skillLocationLabelKey(option.value));
    expect(keys).toEqual([
      'settings.skills.location.option.userPi.label',
      'settings.skills.location.option.projectPi.label',
      'settings.skills.location.option.userAgents.label',
      'settings.skills.location.option.projectAgents.label',
    ]);
  });

  test('new skill defaults to the current project when Settings is scoped to one', () => {
    expect(defaultNewSkillLocation(true, true)).toEqual({ scope: 'project', source: 'pi' });
    expect(defaultNewSkillLocation(true, false)).toEqual({ scope: 'user', source: 'pi' });
    expect(defaultNewSkillLocation(false, true)).toEqual({ scope: 'project', source: 'opencode' });
  });

  test('catalog install Destination is User/Project for the current kernel only', () => {
    expect(getSkillCatalogInstallLocations(true).map((option) => option.value)).toEqual([
      'user-pi',
      'project-pi',
    ]);
    expect(getSkillCatalogInstallLocations(false).map((option) => option.value)).toEqual([
      'user-opencode',
      'project-opencode',
    ]);
  });

  test('OpenCode picker still exposes leftover OpenCode location keys', () => {
    const keys = getSkillLocationOptions(false).map((option) => skillLocationLabelKey(option.value));
    expect(keys).toContain('settings.skills.location.option.userOpencode.label');
    expect(keys).toContain('settings.skills.location.option.projectOpencode.label');
  });
});
