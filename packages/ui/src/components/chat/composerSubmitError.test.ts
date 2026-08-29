import { describe, expect, test } from 'bun:test';

import { classifyComposerSubmitError } from './composerSubmitError';

describe('classifyComposerSubmitError', () => {
  test('maps unknown /plan 404 to a human command error', () => {
    expect(classifyComposerSubmitError(
      new Error('session.command failed (404): {"error":"Unknown command: /plan"}'),
    ).kind).toBe('unknown-command');
  });

  test('maps other session.command failures separately', () => {
    expect(classifyComposerSubmitError(
      new Error('session.command failed (500): plan plugin crashed'),
    ).kind).toBe('command-failed');
  });

  test('keeps runtime-changed and raw messages', () => {
    expect(classifyComposerSubmitError(new Error('Message was not sent because the runtime changed.')).kind)
      .toBe('runtime-changed');
    expect(classifyComposerSubmitError(new Error('disk full')).kind).toBe('raw');
  });
});
