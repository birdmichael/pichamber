/**
 * Linux GTK/Chromium menu chrome renders punctuation accelerators as key
 * names (`Ctrl+Comma`, `Ctrl+Period`). Keep the real Electron accelerator
 * for binding and put the human form in the label's accelerator column.
 *
 * Sequential catalog chords (`Ctrl+K, H`) are not valid Electron accelerators
 * (one key code per binding). Show the catalog string in the label column and
 * do not register a native shortcut; the renderer owns the leader chord.
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

const acceleratorIsSequentialChord = (accelerator) => (
  /,\s*\S/.test(String(accelerator || ''))
);

const acceleratorNeedsLabelColumn = (accelerator, platform) => {
  if (acceleratorIsSequentialChord(accelerator)) {
    return true;
  }
  return platform === 'linux' && acceleratorNeedsLinuxDisplayOverride(accelerator);
};

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

  if (typeof item.accelerator !== 'string') {
    return item;
  }

  if (!acceleratorNeedsLabelColumn(item.accelerator, platform)) {
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
