/**
 * Main-process fallback for Help → Keyboard Shortcuts (`mod+k` then `h`).
 *
 * Electron cannot register sequential accelerators; the renderer owns the
 * leader chord. On Linux Desktop, Ctrl+K sometimes never reaches the
 * renderer (composer / focus quirks), so the H completion inserts as typing.
 * Track Ctrl/Cmd+K → H on before-input-event and fire help-dialog once.
 *
 * Only the H completion is intercepted while a leader is armed — other
 * second keys stay with the renderer.
 */

export const MOD_K_HELP_LEADER_TIMEOUT_MS = 3000;

/**
 * @param {{ timeoutMs?: number }} [options]
 */
export const createModKHelpSequenceTracker = (options = {}) => {
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : MOD_K_HELP_LEADER_TIMEOUT_MS;
  /** @type {number} */
  let armedUntil = 0;

  const disarm = () => {
    armedUntil = 0;
  };

  /**
   * @param {{ type?: string, key?: string, code?: string, control?: boolean, meta?: boolean, alt?: boolean, shift?: boolean }} input
   * @param {number} [now]
   * @returns {{ preventDefault: boolean, fireHelp: boolean, armed: boolean }}
   */
  const handleInput = (input, now = Date.now()) => {
    const type = String(input?.type || '');
    if (type && type !== 'keyDown') {
      return { preventDefault: false, fireHelp: false, armed: armedUntil > now };
    }

    const key = String(input?.key || '');
    const code = String(input?.code || '');
    const control = Boolean(input?.control);
    const meta = Boolean(input?.meta);
    const alt = Boolean(input?.alt);
    const primary = control || meta;
    const isModK = primary
      && !alt
      && (key === 'k' || key === 'K' || code === 'KeyK');

    if (isModK) {
      armedUntil = now + timeoutMs;
      // Let the renderer still arm its own leader for other mod+k chords.
      return { preventDefault: false, fireHelp: false, armed: true };
    }

    if (armedUntil <= now) {
      disarm();
      return { preventDefault: false, fireHelp: false, armed: false };
    }

    // Second key while leader is armed.
    const isHelpKey = !primary
      && !alt
      && (key === 'h' || key === 'H' || code === 'KeyH');

    if (isHelpKey) {
      disarm();
      return { preventDefault: true, fireHelp: true, armed: false };
    }

    // Other second keys: drop the main-process arm so we do not steal a later H,
    // but do not preventDefault — renderer owns those chords.
    disarm();
    return { preventDefault: false, fireHelp: false, armed: false };
  };

  return {
    handleInput,
    reset: disarm,
    isArmed: (now = Date.now()) => armedUntil > now,
  };
};

/**
 * @param {import('electron').WebContents} webContents
 * @param {{ onHelp: () => void, timeoutMs?: number }} options
 */
export const attachModKHelpSequenceFallback = (webContents, options) => {
  if (!webContents || typeof webContents.on !== 'function') return () => {};
  const tracker = createModKHelpSequenceTracker({ timeoutMs: options?.timeoutMs });
  const onBeforeInput = (event, input) => {
    const result = tracker.handleInput(input);
    if (result.preventDefault && event && typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
    if (result.fireHelp && typeof options?.onHelp === 'function') {
      options.onHelp();
    }
  };
  webContents.on('before-input-event', onBeforeInput);
  return () => {
    if (typeof webContents.removeListener === 'function') {
      webContents.removeListener('before-input-event', onBeforeInput);
    }
    tracker.reset();
  };
};
