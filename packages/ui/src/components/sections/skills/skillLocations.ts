import type { I18nKey } from '@/lib/i18n';
import type { SkillScope, SkillSource } from '@/stores/useSkillsStore';

export type SkillLocationValue =
  | 'user-pi'
  | 'project-pi'
  | 'user-opencode'
  | 'project-opencode'
  | 'user-claude'
  | 'project-claude'
  | 'user-agents'
  | 'project-agents';

export const PI_SKILL_LOCATION_OPTIONS: Array<{
  value: SkillLocationValue;
  scope: SkillScope;
  source: SkillSource;
}> = [
  { value: 'user-pi', scope: 'user', source: 'pi' },
  { value: 'project-pi', scope: 'project', source: 'pi' },
  { value: 'user-agents', scope: 'user', source: 'agents' },
  { value: 'project-agents', scope: 'project', source: 'agents' },
];

export const OPENCODE_SKILL_LOCATION_OPTIONS: Array<{
  value: SkillLocationValue;
  scope: SkillScope;
  source: SkillSource;
}> = [
  { value: 'user-opencode', scope: 'user', source: 'opencode' },
  { value: 'project-opencode', scope: 'project', source: 'opencode' },
  { value: 'user-agents', scope: 'user', source: 'agents' },
  { value: 'project-agents', scope: 'project', source: 'agents' },
];

export function getSkillLocationOptions(isPiKernel: boolean) {
  return isPiKernel ? PI_SKILL_LOCATION_OPTIONS : OPENCODE_SKILL_LOCATION_OPTIONS;
}

export function defaultSkillSource(isPiKernel: boolean): 'pi' | 'opencode' {
  return isPiKernel ? 'pi' : 'opencode';
}

export function locationValueFrom(scope: SkillScope, source: SkillSource): SkillLocationValue {
  if (scope === 'project' && source === 'claude') return 'project-claude';
  if (scope === 'project' && source === 'agents') return 'project-agents';
  if (scope === 'project' && source === 'pi') return 'project-pi';
  if (scope === 'project' && source === 'opencode') return 'project-opencode';
  if (source === 'claude') return 'user-claude';
  if (source === 'agents') return 'user-agents';
  if (source === 'pi') return 'user-pi';
  return 'user-opencode';
}

export function skillLocationLabelKey(value: SkillLocationValue): I18nKey {
  switch (value) {
    case 'user-pi':
      return 'settings.skills.location.option.userPi.label';
    case 'project-pi':
      return 'settings.skills.location.option.projectPi.label';
    case 'user-opencode':
      return 'settings.skills.location.option.userOpencode.label';
    case 'project-opencode':
      return 'settings.skills.location.option.projectOpencode.label';
    case 'user-claude':
      return 'settings.skills.location.option.userClaude.label';
    case 'project-claude':
      return 'settings.skills.location.option.projectClaude.label';
    case 'user-agents':
      return 'settings.skills.location.option.userAgents.label';
    case 'project-agents':
      return 'settings.skills.location.option.projectAgents.label';
  }
}

export function skillLocationDescriptionKey(value: SkillLocationValue): I18nKey {
  switch (value) {
    case 'user-pi':
      return 'settings.skills.location.option.userPi.description';
    case 'project-pi':
      return 'settings.skills.location.option.projectPi.description';
    case 'user-opencode':
      return 'settings.skills.location.option.userOpencode.description';
    case 'project-opencode':
      return 'settings.skills.location.option.projectOpencode.description';
    case 'user-claude':
      return 'settings.skills.location.option.userClaude.description';
    case 'project-claude':
      return 'settings.skills.location.option.projectClaude.description';
    case 'user-agents':
      return 'settings.skills.location.option.userAgents.description';
    case 'project-agents':
      return 'settings.skills.location.option.projectAgents.description';
  }
}

export function skillSourceBadgeKey(source: SkillSource | undefined): I18nKey {
  if (source === 'claude') return 'settings.skills.sidebar.badge.claude';
  if (source === 'agents') return 'settings.skills.sidebar.badge.agents';
  if (source === 'pi') return 'settings.skills.sidebar.badge.pi';
  return 'settings.skills.sidebar.badge.opencode';
}

export function locationPartsFrom(value: SkillLocationValue): { scope: SkillScope; source: SkillSource } {
  if (value === 'user-claude') return { scope: 'user', source: 'claude' };
  if (value === 'project-claude') return { scope: 'project', source: 'claude' };
  if (value === 'user-pi') return { scope: 'user', source: 'pi' };
  if (value === 'project-pi') return { scope: 'project', source: 'pi' };
  if (value === 'user-opencode') return { scope: 'user', source: 'opencode' };
  if (value === 'project-opencode') return { scope: 'project', source: 'opencode' };
  if (value === 'user-agents') return { scope: 'user', source: 'agents' };
  if (value === 'project-agents') return { scope: 'project', source: 'agents' };
  return { scope: 'user', source: 'pi' };
}
