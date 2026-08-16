import { describe, expect, test } from 'bun:test';
import {
  defaultSkillSource,
  getSkillLocationOptions,
  locationPartsFrom,
  locationValueFrom,
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
});
