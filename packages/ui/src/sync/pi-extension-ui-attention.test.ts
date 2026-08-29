import { describe, expect, test } from 'bun:test';

import { countPendingPiExtensionUiPrompts } from './pi-extension-ui-store';
import type { PiExtensionUiPrompt } from './pi-extension-ui';

const pending = (id: string, sessionID: string, kind: PiExtensionUiPrompt['kind'] = 'select'): PiExtensionUiPrompt => ({
  id,
  sessionID,
  kind,
  title: 'Should we continue?',
  status: 'pending',
});

describe('countPendingPiExtensionUiPrompts', () => {
  test('counts blocking pending prompts across sidebar session scopes', () => {
    expect(countPendingPiExtensionUiPrompts({
      ses_a: [pending('pui_1', 'ses_a'), { ...pending('pui_2', 'ses_a'), status: 'replied' }],
      ses_b: [pending('pui_3', 'ses_b', 'confirm')],
    }, ['ses_a', 'ses_b'])).toBe(2);
  });

  test('ignores sessions outside the requested scopes', () => {
    expect(countPendingPiExtensionUiPrompts({
      ses_a: [pending('pui_1', 'ses_a')],
      ses_other: [pending('pui_9', 'ses_other')],
    }, ['ses_a'])).toBe(1);
  });
});
