import { describe, expect, test } from 'bun:test';

import { MULTIRUN_EXECUTION_FORK_PROMPT_META_TEXT } from './executionMeta';

describe('executionMeta', () => {
  test('uses below, not the bellow typo', () => {
    expect(MULTIRUN_EXECUTION_FORK_PROMPT_META_TEXT).toContain('This message below comes from an AI agent');
    expect(MULTIRUN_EXECUTION_FORK_PROMPT_META_TEXT).not.toContain('bellow');
  });
});
