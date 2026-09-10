import { describe, expect, test } from 'bun:test';
import { getShortcutAction } from './schema';
import { getShortcutConflict } from './bindings';

/**
 * Go menu (Electron) advertises Ctrl+[ / Ctrl+] for directory Back/Forward.
 * Favorite model cycling must not share those chords (#686).
 */
describe('favorite model cycle vs Go history shortcuts', () => {
  test('defaults leave Ctrl+[ and Ctrl+] free for Go Back/Forward', () => {
    expect(getShortcutAction('cycle_favorite_model_backward')?.defaultBinding).not.toBe('ctrl+[');
    expect(getShortcutAction('cycle_favorite_model_forward')?.defaultBinding).not.toBe('ctrl+]');
  });

  test('favorite cycling uses Alt+Shift+bracket chords', () => {
    expect(getShortcutAction('cycle_favorite_model_forward')?.defaultBinding).toBe('alt+shift+]');
    expect(getShortcutAction('cycle_favorite_model_backward')?.defaultBinding).toBe('alt+shift+[');
  });

  test('does not collide with cycle_services_tab when mod resolves to ctrl', () => {
    const favorite = getShortcutAction('cycle_favorite_model_backward')!.defaultBinding;
    const services = getShortcutAction('cycle_services_tab')!.defaultBinding;
    expect(getShortcutConflict(favorite, services)).toBeUndefined();
  });
});
