import { describe, expect, test } from 'bun:test';

import { getDefaultMagicPromptTemplate, getMagicPromptDefinition } from './magicPrompts';

describe('git generation magic prompts', () => {
  test('commit instructions ask the model to match recent commit style and language', () => {
    const definition = getMagicPromptDefinition('git.commit.generate.instructions');
    expect(definition.placeholders?.map((placeholder) => placeholder.key)).toContain('recent_commits');

    const template = getDefaultMagicPromptTemplate('git.commit.generate.instructions');
    expect(template).toContain('{{recent_commits}}');
    expect(template).toContain('match the style of the recent commits below');
    expect(template).toContain('if the recent commits are written in a language other than English');
  });

  test('PR instructions reuse a repository template when one is supplied', () => {
    const definition = getMagicPromptDefinition('git.pr.generate.instructions');
    expect(definition.placeholders?.map((placeholder) => placeholder.key)).toContain('pr_template_block');

    const template = getDefaultMagicPromptTemplate('git.pr.generate.instructions');
    expect(template).toContain('{{pr_template_block}}');
    expect(template).toContain('when a repository pull request template is included below');
    expect(template).toContain('when no template is included: markdown with sections ## Summary, ## Why, ## Testing');
  });
});
