import { describe, expect, test } from 'bun:test';

import { nextSettingsRevealArmed, shouldConsumeSettingsRevealEvent } from './settings-reveal-guard';

describe('settings reveal click guard', () => {
  test('swallows the first pointer gesture on the newly revealed row', () => {
    expect(shouldConsumeSettingsRevealEvent({ armed: true, insideRevealed: true })).toBe(true);
    expect(nextSettingsRevealArmed({
      armed: true,
      phase: 'pointerdown',
      insideRevealed: true,
    })).toBe(true);
    expect(nextSettingsRevealArmed({
      armed: true,
      phase: 'pointerup',
      insideRevealed: true,
    })).toBe(true);
    expect(nextSettingsRevealArmed({
      armed: true,
      phase: 'click',
      insideRevealed: true,
    })).toBe(false);
  });

  test('lets the next gesture through after that first click', () => {
    expect(shouldConsumeSettingsRevealEvent({ armed: false, insideRevealed: true })).toBe(false);
    expect(nextSettingsRevealArmed({
      armed: false,
      phase: 'click',
      insideRevealed: true,
    })).toBe(false);
  });

  test('does not steal a press outside the revealed row', () => {
    expect(shouldConsumeSettingsRevealEvent({ armed: true, insideRevealed: false })).toBe(false);
    expect(nextSettingsRevealArmed({
      armed: true,
      phase: 'pointerdown',
      insideRevealed: false,
    })).toBe(false);
  });

  test('does not swallow a keyboard activation of the new row', () => {
    expect(shouldConsumeSettingsRevealEvent({
      armed: true,
      insideRevealed: true,
      isKeyboardClick: true,
    })).toBe(false);
    expect(nextSettingsRevealArmed({
      armed: true,
      phase: 'click',
      insideRevealed: true,
      isKeyboardClick: true,
    })).toBe(false);
  });
});
