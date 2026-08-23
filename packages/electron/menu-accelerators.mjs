/**
 * Linux GTK/Chromium menu chrome renders punctuation accelerators as key
 * names (`Ctrl+Comma`, `Ctrl+Period`). Keep the real Electron accelerator
 * for binding and put the human form in the label's accelerator column.
 */

const PUNCTUATION_DISPLAY = new Map([
  [',', ','],
  ['.', '.'],
  ['comma', ','],
  ['period', '.'],
]);

export const formatNativeMenuAcceleratorForDisplay = (accelerator) => {
  if (typeof accelerator !== 'string' || accelerator.length === 0) {
    return '';
  }

  return accelerator
    .split('+')
    .map((part) => {
      const trimmed = part.trim();
      return PUNCTUATION_DISPLAY.get(trimmed.toLowerCase()) ?? trimmed;
    })
    .join('+');
};

const acceleratorNeedsLinuxDisplayOverride = (accelerator) => (
  /(?:^|\+)(?:,|\.|comma|period)(?:\+|$)/i.test(String(accelerator || ''))
);

const decorateMenuItemForPlatform = (item, platform = process.platform) => {
  if (!item || typeof item !== 'object') {
    return item;
  }

  if (Array.isArray(item.submenu)) {
    return {
      ...item,
      submenu: decorateMenuTemplateForPlatform(item.submenu, platform),
    };
  }

  if (platform !== 'linux' || typeof item.accelerator !== 'string') {
    return item;
  }

  if (!acceleratorNeedsLinuxDisplayOverride(item.accelerator)) {
    return item;
  }

  const label = typeof item.label === 'string' ? item.label : '';
  if (label.includes('\t')) {
    return item;
  }

  return {
    ...item,
    label: `${label}\t${formatNativeMenuAcceleratorForDisplay(item.accelerator)}`,
    // Renderer already owns these chords; keep the hint without a second
    // native registration, and without GTK's "Comma"/"Period" labels.
    accelerator: undefined,
    registerAccelerator: false,
  };
};

export const decorateMenuTemplateForPlatform = (template, platform = process.platform) => {
  if (!Array.isArray(template)) {
    return template;
  }
  return template.map((item) => decorateMenuItemForPlatform(item, platform));
};
