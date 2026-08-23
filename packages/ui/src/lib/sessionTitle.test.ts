import { describe, expect, test } from 'bun:test';

import { isPlaceholderSessionTitle, resolveSessionDisplayTitle } from './sessionTitle';

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

  test('maps every empty-session placeholder to one untitled label', () => {
    const untitled = 'Untitled Session';
    expect(resolveSessionDisplayTitle('', untitled)).toBe(untitled);
    expect(resolveSessionDisplayTitle('New session', untitled)).toBe(untitled);
    expect(resolveSessionDisplayTitle('Pi session', untitled)).toBe(untitled);
    expect(resolveSessionDisplayTitle('(no messages)', untitled)).toBe(untitled);
    expect(resolveSessionDisplayTitle('195-daily-ping hello', untitled)).toBe('195-daily-ping hello');
  });
});
