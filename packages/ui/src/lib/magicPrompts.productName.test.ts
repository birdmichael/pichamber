import { describe, expect, test } from 'bun:test';

import { getDefaultMagicPromptTemplate } from './magicPrompts';

describe('empty-state chip magic prompts', () => {
  test('visible craft/schedule lines stay short and product-named Pichamber in hidden copy', () => {
    const craftVisible = getDefaultMagicPromptTemplate('session.craftGoal.visible');
    const scheduleVisible = getDefaultMagicPromptTemplate('session.scheduleTask.visible');
    expect(craftVisible).toBe('Help me turn an idea or task into a clear, verifiable Goal.{{idea_block}}');
    expect(scheduleVisible).toBe('Help me set up a scheduled task.{{idea_block}}');
    expect(craftVisible.length).toBeLessThan(120);
    expect(scheduleVisible.length).toBeLessThan(80);

    const scheduleInstructions = getDefaultMagicPromptTemplate('session.scheduleTask.instructions');
    const craftInstructions = getDefaultMagicPromptTemplate('session.craftGoal.instructions');
    const handoff = getDefaultMagicPromptTemplate('session.reviewHandoff.instructions');
    expect(scheduleInstructions).toContain('Pichamber');
    expect(scheduleInstructions).not.toContain('OpenChamber');
    expect(handoff).toContain('Pichamber');
    expect(handoff).not.toContain('OpenChamber');
    expect(craftInstructions).not.toContain('OpenChamber');
    expect(scheduleInstructions).toContain('`openchamber`');
  });
});
