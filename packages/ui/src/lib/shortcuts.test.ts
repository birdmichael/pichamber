import { describe, expect, test } from 'bun:test';

import {
  eventMatchesShortcut,
  eventMatchesShortcutPrefix,
  formatShortcutForDisplay,
  getEffectiveShortcutPrefix,
  isShortcutPrefixHeld,
  UNASSIGNED_SHORTCUT,
} from './shortcuts';

describe('getEffectiveShortcutPrefix', () => {
  test('falls back to the action default (bare mod) when unset', () => {
    expect(getEffectiveShortcutPrefix('switch_context_surface', {})).toBe('mod');
  });

  test('honors modifier + key overrides', () => {
    expect(getEffectiveShortcutPrefix('switch_context_surface', { switch_context_surface: 'mod+p' })).toBe('mod+p');
  });

  test('honors modifier-only overrides', () => {
    expect(getEffectiveShortcutPrefix('switch_context_surface', { switch_context_surface: 'shift' })).toBe('shift');
  });

  test('returns UNASSIGNED for an explicit unassignment', () => {
    expect(
      getEffectiveShortcutPrefix('switch_context_surface', { switch_context_surface: UNASSIGNED_SHORTCUT }),
    ).toBe(UNASSIGNED_SHORTCUT);
  });

  test('returns empty string for an unknown action', () => {
    expect(getEffectiveShortcutPrefix('does_not_exist', {})).toBe('');
  });
});

describe('isShortcutPrefixHeld', () => {
  test('false for an unassigned prefix', () => {
    expect(isShortcutPrefixHeld(UNASSIGNED_SHORTCUT, new Set(['control']))).toBe(false);
  });

  test('requires the prefix primary key to be held', () => {
    expect(isShortcutPrefixHeld('mod+p', new Set(['control']))).toBe(false);
    expect(isShortcutPrefixHeld('mod+p', new Set(['control', 'p']))).toBe(true);
  });

  test('requires every prefix modifier to be held', () => {
    expect(isShortcutPrefixHeld('mod+shift', new Set(['control']))).toBe(false);
    expect(isShortcutPrefixHeld('mod+shift', new Set(['control', 'shift']))).toBe(true);
  });
});

const keydown = (
  key: string,
  mods: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean; code?: string } = {},
): KeyboardEvent =>
  ({
    key,
    code: mods.code ?? '',
    metaKey: mods.meta ?? false,
    ctrlKey: mods.ctrl ?? false,
    shiftKey: mods.shift ?? false,
    altKey: mods.alt ?? false,
  }) as KeyboardEvent;

describe('eventMatchesShortcutPrefix', () => {
  test('matches a bare mod prefix when the primary modifier is held', () => {
    expect(eventMatchesShortcutPrefix(keydown('1', { ctrl: true }), 'mod')).toBe(true);
  });

  test('rejects a bare mod prefix without the primary modifier', () => {
    expect(eventMatchesShortcutPrefix(keydown('1', {}), 'mod')).toBe(false);
  });

  test('rejects when the event carries modifiers the prefix does not expect', () => {
    expect(eventMatchesShortcutPrefix(keydown('1', { ctrl: true, shift: true }), 'mod')).toBe(false);
  });

  test('requires the prefix primary key to be held at match time', () => {
    expect(eventMatchesShortcutPrefix(keydown('1', { ctrl: true }), 'mod+p', new Set(['control']))).toBe(false);
    expect(eventMatchesShortcutPrefix(keydown('1', { ctrl: true }), 'mod+p', new Set(['control', 'p']))).toBe(true);
  });

  test('false for an unassigned prefix', () => {
    expect(eventMatchesShortcutPrefix(keydown('1', { ctrl: true }), UNASSIGNED_SHORTCUT)).toBe(false);
  });
});

const withPlatform = <T>(
  options: { userAgent: string; desktop?: boolean },
  run: () => T,
): T => {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent: options.userAgent, platform: '' },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: options.desktop
      ? { __OPENCHAMBER_ELECTRON__: { runtime: 'electron' } }
      : {},
  });
  try {
    return run();
  } finally {
    if (previousNavigator) {
      Object.defineProperty(globalThis, 'navigator', previousNavigator);
    } else {
      Reflect.deleteProperty(globalThis, 'navigator');
    }
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }
};

describe('eventMatchesShortcut', () => {
  test('matches Ctrl+, from event.code when event.key is empty', () => {
    withPlatform({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', desktop: true }, () => {
      expect(eventMatchesShortcut(keydown('', { ctrl: true, code: 'Comma' }), 'mod+comma')).toBe(true);
    });
  });

  test('rejects Ctrl+, without the modifier', () => {
    withPlatform({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', desktop: true }, () => {
      expect(eventMatchesShortcut(keydown(',', { code: 'Comma' }), 'mod+comma')).toBe(false);
    });
  });
});

describe('formatShortcutForDisplay', () => {
  test('Linux desktop uses Ctrl/Alt and a comma glyph, not Mac symbols', () => {
    withPlatform({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', desktop: true }, () => {
      expect(formatShortcutForDisplay('mod+alt+v')).toBe('Ctrl + Alt + V');
      expect(formatShortcutForDisplay('alt+g')).toBe('Alt + G');
      expect(formatShortcutForDisplay('ctrl+]')).toBe('Ctrl + ]');
      expect(formatShortcutForDisplay('ctrl+[')).toBe('Ctrl + [');
      expect(formatShortcutForDisplay('mod+comma')).toBe('Ctrl + ,');
    });
  });

  test('macOS desktop keeps ⌘/⌥/⌃', () => {
    withPlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', desktop: true }, () => {
      expect(formatShortcutForDisplay('mod+alt+v')).toBe('⌘ + ⌥ + V');
      expect(formatShortcutForDisplay('alt+g')).toBe('⌥ + G');
      expect(formatShortcutForDisplay('ctrl+]')).toBe('⌃ + ]');
      expect(formatShortcutForDisplay('mod+comma')).toBe('⌘ + ,');
    });
  });
});
