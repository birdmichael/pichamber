/**
 * View-menu theme radios for Electron (macOS menu bar + Linux hamburger).
 * `mode` is the user's intent (light | dark | system), not the resolved OS appearance.
 */

export function normalizeThemeMenuMode(mode) {
  if (mode === 'light' || mode === 'dark' || mode === 'system') {
    return mode;
  }
  return 'system';
}

/**
 * @param {string} mode
 * @returns {Array<{ type: 'radio', label: string, checked: boolean, action: string }>}
 */
export function themeMenuItemDescriptors(mode) {
  const normalized = normalizeThemeMenuMode(mode);
  return [
    {
      type: 'radio',
      label: 'Light Theme',
      checked: normalized === 'light',
      action: 'theme-light',
    },
    {
      type: 'radio',
      label: 'Dark Theme',
      checked: normalized === 'dark',
      action: 'theme-dark',
    },
    {
      type: 'radio',
      label: 'System Theme',
      checked: normalized === 'system',
      action: 'theme-system',
    },
  ];
}
