import { describe, expect, test } from 'bun:test';

import { isPlaceholderSessionTitle, resolveSessionDisplayTitle, resolveSessionDisplayTitleFrom } from './sessionTitle';

describe('session display titles', () => {
  test('treats empty and default labels as placeholders', () => {
    expect(isPlaceholderSessionTitle('')).toBe(true);
    expect(isPlaceholderSessionTitle('   ')).toBe(true);
    expect(isPlaceholderSessionTitle(null)).toBe(true);
    expect(isPlaceholderSessionTitle('New session')).toBe(true);
    expect(isPlaceholderSessionTitle('Pi session')).toBe(true);
    expect(isPlaceholderSessionTitle('Untitled Session')).toBe(true);
    expect(isPlaceholderSessionTitle('(no messages)')).toBe(true);
    expect(isPlaceholderSessionTitle('no messages')).toBe(true);
    expect(isPlaceholderSessionTitle('195-daily-ping hello')).toBe(false);
    expect(isPlaceholderSessionTitle('hello')).toBe(false);
  });

  test('maps Goal preamble and continue-only titles to untitled', () => {
    const untitled = 'Untitled Session';
    expect(resolveSessionDisplayTitle('Goal mode is active. Complete this goal fully: say bye', untitled)).toBe(untitled);
    expect(resolveSessionDisplayTitle('继续', untitled)).toBe(untitled);
    expect(resolveSessionDisplayTitle('continue', untitled)).toBe(untitled);
    expect(resolveSessionDisplayTitle('say bye', untitled)).toBe('say bye');
  });

  test('maps every empty-session placeholder to one untitled label', () => {
    const untitled = 'Untitled Session';
    expect(resolveSessionDisplayTitle('', untitled)).toBe(untitled);
    expect(resolveSessionDisplayTitle('New session', untitled)).toBe(untitled);
    expect(resolveSessionDisplayTitle('Pi session', untitled)).toBe(untitled);
    expect(resolveSessionDisplayTitle('(no messages)', untitled)).toBe(untitled);
    expect(resolveSessionDisplayTitle('195-daily-ping hello', untitled)).toBe('195-daily-ping hello');
  });

  test('prefers a listed title over a live placeholder', () => {
    const untitled = 'Untitled Session';
    expect(resolveSessionDisplayTitleFrom(
      ['New session', '帮我提一个issue，为什么手机发送的图片'],
      untitled,
    )).toBe('帮我提一个issue，为什么手机发送的图片');
    expect(resolveSessionDisplayTitleFrom(
      ['帮我提一个issue', 'New session'],
      untitled,
    )).toBe('帮我提一个issue');
    expect(resolveSessionDisplayTitleFrom(
      [null, 'New session', ''],
      untitled,
    )).toBe(untitled);
  });
});
