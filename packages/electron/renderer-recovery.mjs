const RECOVERY_WINDOW_MS = 60_000;
const MAX_RECOVERY_ATTEMPTS = 3;

const RECOVERABLE_REASONS = new Set([
  'abnormal-exit',
  'crashed',
  'oom',
  'memory-eviction',
]);

// Stagger reloads so a crash loop does not stampede dynamic imports
// (MarkdownRenderer / shiki grammars) mid-fetch and leave Chat Error / splash.
const RELOAD_DELAYS_MS = [250, 1_000, 2_500];

export const reloadDelayForAttempt = (attemptNumber) => {
  const index = Math.min(Math.max(attemptNumber, 1), RELOAD_DELAYS_MS.length) - 1;
  return RELOAD_DELAYS_MS[index];
};

export const createRendererRecoveryPolicy = (now = Date.now) => {
  let windowStartedAt = 0;
  let attempts = 0;

  const decide = (reason) => {
    if (!RECOVERABLE_REASONS.has(reason)) {
      return { reload: false, reason: 'unrecoverable' };
    }

    const currentTime = now();
    if (currentTime - windowStartedAt >= RECOVERY_WINDOW_MS) {
      windowStartedAt = currentTime;
      attempts = 0;
    }
    if (attempts >= MAX_RECOVERY_ATTEMPTS) {
      return { reload: false, reason: 'budget-exhausted' };
    }

    attempts += 1;
    return {
      reload: true,
      attempt: attempts,
      delayMs: reloadDelayForAttempt(attempts),
    };
  };

  return {
    decide,
    shouldReload: (reason) => decide(reason).reload,
  };
};

/**
 * Reload a window whose renderer process died, within the recovery budget.
 * Shared by every BrowserWindow so the desktop shell has one recovery policy.
 */
export const attachRendererRecovery = (browserWindow, { log, label }) => {
  const policy = createRendererRecoveryPolicy();
  browserWindow.webContents.on('render-process-gone', (_event, details) => {
    const decision = policy.decide(details.reason);
    if (!decision.reload) {
      if (decision.reason === 'budget-exhausted') {
        log.error('[electron] renderer exited unexpectedly; recovery budget exhausted', {
          label: browserWindow.__ocLabel,
          surface: label,
          reason: details.reason,
          exitCode: details.exitCode,
        });
      }
      return;
    }
    log.warn('[electron] renderer exited unexpectedly; reloading window', {
      label: browserWindow.__ocLabel,
      surface: label,
      reason: details.reason,
      exitCode: details.exitCode,
      attempt: decision.attempt,
      delayMs: decision.delayMs,
    });
    setTimeout(() => {
      if (!browserWindow.isDestroyed()) {
        browserWindow.webContents.reload();
      }
    }, decision.delayMs);
  });
};
