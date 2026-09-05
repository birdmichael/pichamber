import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';

import {
  attachRendererRecovery,
  createRendererRecoveryPolicy,
  reloadDelayForAttempt,
} from './renderer-recovery.mjs';

const createFakeWindow = () => {
  const listeners = new Map();
  const state = { reloads: 0, destroyed: false };
  const browserWindow = {
    __ocLabel: 'main',
    state,
    destroy: () => {
      state.destroyed = true;
    },
    emit: (event, details) => listeners.get(event)?.(null, details),
    isDestroyed: () => state.destroyed,
    webContents: {
      on: (event, listener) => listeners.set(event, listener),
      reload: () => {
        state.reloads += 1;
      },
    },
  };
  return browserWindow;
};

const createFakeLog = () => {
  const warnings = [];
  const errors = [];
  return {
    warnings,
    errors,
    warn: (message, payload) => warnings.push({ message, payload }),
    error: (message, payload) => errors.push({ message, payload }),
  };
};

test('allows a bounded number of reloads for recoverable renderer failures', () => {
  const policy = createRendererRecoveryPolicy(() => 1_000);

  assert.equal(policy.shouldReload('crashed'), true);
  assert.equal(policy.shouldReload('oom'), true);
  assert.equal(policy.shouldReload('abnormal-exit'), true);
  assert.equal(policy.shouldReload('crashed'), false);
});

test('reloads after the renderer is evicted for memory', () => {
  const policy = createRendererRecoveryPolicy(() => 1_000);

  assert.equal(policy.shouldReload('memory-eviction'), true);
});

test('ignores reasons Electron never reports for render-process-gone', () => {
  const policy = createRendererRecoveryPolicy(() => 1_000);

  assert.equal(policy.shouldReload('made-up-reason'), false);
  assert.equal(policy.shouldReload('crashed'), true);
});

test('ignores clean and externally killed renderer exits', () => {
  const policy = createRendererRecoveryPolicy(() => 1_000);

  assert.equal(policy.shouldReload('clean-exit'), false);
  assert.equal(policy.shouldReload('killed'), false);
  assert.equal(policy.shouldReload('launch-failed'), false);
});

test('resets the recovery budget after the recovery window', () => {
  let currentTime = 1_000;
  const policy = createRendererRecoveryPolicy(() => currentTime);

  assert.equal(policy.shouldReload('crashed'), true);
  assert.equal(policy.shouldReload('crashed'), true);
  assert.equal(policy.shouldReload('crashed'), true);
  assert.equal(policy.shouldReload('crashed'), false);

  currentTime += 60_000;
  assert.equal(policy.shouldReload('crashed'), true);
});

test('staggers reload delays across recovery attempts', () => {
  assert.equal(reloadDelayForAttempt(1), 250);
  assert.equal(reloadDelayForAttempt(2), 1_000);
  assert.equal(reloadDelayForAttempt(3), 2_500);
  assert.equal(reloadDelayForAttempt(99), 2_500);

  const policy = createRendererRecoveryPolicy(() => 1_000);
  assert.deepEqual(policy.decide('crashed'), { reload: true, attempt: 1, delayMs: 250 });
  assert.deepEqual(policy.decide('crashed'), { reload: true, attempt: 2, delayMs: 1_000 });
  assert.deepEqual(policy.decide('crashed'), { reload: true, attempt: 3, delayMs: 2_500 });
  assert.deepEqual(policy.decide('crashed'), { reload: false, reason: 'budget-exhausted' });
});

test('reloads the attached window after a recoverable renderer failure', async () => {
  const browserWindow = createFakeWindow();
  const log = createFakeLog();
  attachRendererRecovery(browserWindow, { log, label: 'mini chat' });

  browserWindow.emit('render-process-gone', { reason: 'crashed', exitCode: 5 });
  await setTimeout(350);

  assert.equal(browserWindow.state.reloads, 1);
  assert.equal(log.warnings.length, 1);
  assert.equal(log.warnings[0].payload.surface, 'mini chat');
  assert.equal(log.warnings[0].payload.label, 'main');
  assert.equal(log.warnings[0].payload.attempt, 1);
  assert.equal(log.warnings[0].payload.delayMs, 250);
});

test('skips the reload when the window is gone or the exit is not recoverable', async () => {
  const browserWindow = createFakeWindow();
  attachRendererRecovery(browserWindow, { log: createFakeLog(), label: 'window' });

  browserWindow.emit('render-process-gone', { reason: 'clean-exit', exitCode: 0 });
  browserWindow.emit('render-process-gone', { reason: 'crashed', exitCode: 5 });
  browserWindow.destroy();
  await setTimeout(350);

  assert.equal(browserWindow.state.reloads, 0);
});

test('logs when the recovery budget is exhausted', async () => {
  const browserWindow = createFakeWindow();
  const log = createFakeLog();
  attachRendererRecovery(browserWindow, { log, label: 'window' });

  browserWindow.emit('render-process-gone', { reason: 'crashed', exitCode: 5 });
  browserWindow.emit('render-process-gone', { reason: 'crashed', exitCode: 5 });
  browserWindow.emit('render-process-gone', { reason: 'crashed', exitCode: 5 });
  browserWindow.emit('render-process-gone', { reason: 'crashed', exitCode: 5 });
  await setTimeout(3_000);

  assert.equal(browserWindow.state.reloads, 3);
  assert.equal(log.errors.length, 1);
  assert.match(log.errors[0].message, /recovery budget exhausted/);
});
