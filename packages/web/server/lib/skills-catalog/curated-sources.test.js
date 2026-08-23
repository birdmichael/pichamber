import { describe, expect, it } from 'vitest';
import { getCuratedSkillsSources } from './curated-sources.js';

describe('getCuratedSkillsSources', () => {
  it('includes the official GitHub skill collections', () => {
    const sources = getCuratedSkillsSources();
    expect(sources.map((source) => source.id)).toEqual([
      'anthropic',
      'openai',
      'cursor',
      'mattpocock',
      'clawdhub',
    ]);
    expect(sources.find((source) => source.id === 'anthropic')?.source).toBe('anthropics/skills');
    expect(sources.find((source) => source.id === 'openai')?.source).toBe('openai/skills');
    expect(sources.find((source) => source.id === 'cursor')?.source).toBe('cursor/plugins');
    expect(sources.find((source) => source.id === 'mattpocock')?.source).toBe('mattpocock/skills');
  });

  it('labels the ClawHub curated source as ClawHub', () => {
    const clawhub = getCuratedSkillsSources().find((source) => source.id === 'clawdhub');
    expect(clawhub).toBeDefined();
    expect(clawhub.label).toBe('ClawHub');
  });
});
