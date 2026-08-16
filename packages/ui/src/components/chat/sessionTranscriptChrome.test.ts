import { describe, expect, test } from 'bun:test';

import { sessionTranscriptHasChrome } from './sessionTranscriptChrome';

describe('sessionTranscriptHasChrome', () => {
  test('treats a pending ctx.ui card as transcript content on an otherwise empty session', () => {
    expect(sessionTranscriptHasChrome({
      messageCount: 0,
      sessionIsWorking: false,
      questionCount: 0,
      permissionCount: 0,
      transcriptPromptCount: 1,
    })).toBe(true);
  });

  test('waits for the authoritative prompt fetch before showing the empty welcome', () => {
    expect(sessionTranscriptHasChrome({
      messageCount: 0,
      sessionIsWorking: false,
      questionCount: 0,
      permissionCount: 0,
      transcriptPromptCount: 0,
      waitingForAuthoritativePrompts: true,
    })).toBe(true);
    expect(sessionTranscriptHasChrome({
      messageCount: 0,
      sessionIsWorking: false,
      questionCount: 0,
      permissionCount: 0,
      transcriptPromptCount: 0,
    })).toBe(false);
  });
});
