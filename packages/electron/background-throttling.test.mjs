import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  applyWindowBackgroundThrottling,
  bindWindowBackgroundThrottling,
  createHiddenWindowTrayRepeater,
  isWindowPaintingAtFullRate,
  resolveBackgroundThrottling,
  shouldPaintAtFullRate,
} from './background-throttling.mjs';

const createFakeWindow = ({
  focused = false,
  visible = false,
  minimized = false,
  destroyed = false,
} = {}) => {
  const listeners = new Map();
  const windowState = { focused, visible, minimized, destroyed };
  return {
    windowState,
    webContents: { backgroundThrottling: true },
    isDestroyed: () => windowState.destroyed,
    isFocused: () => windowState.focused,
    isVisible: () => windowState.visible,
    isMinimized: () => windowState.minimized,
    on(event, handler) {
      const list = listeners.get(event) ?? [];
      list.push(handler);
      listeners.set(event, list);
    },
    emit(event) {
      for (const handler of listeners.get(event) ?? []) handler();
    },
  };
};

test('backgroundThrottling stays on unless the window is focused and visible', () => {
  assert.equal(shouldPaintAtFullRate({ focused: false, visible: false }), false);
  assert.equal(shouldPaintAtFullRate({ focused: false, visible: true }), false);
  assert.equal(shouldPaintAtFullRate({ focused: true, visible: false }), false);
  assert.equal(shouldPaintAtFullRate({ focused: true, visible: true }), true);

  assert.equal(resolveBackgroundThrottling({ focused: false, visible: false }), true);
  assert.equal(resolveBackgroundThrottling({ focused: false, visible: true }), true);
  assert.equal(resolveBackgroundThrottling({ focused: true, visible: false }), true);
  assert.equal(resolveBackgroundThrottling({ focused: true, visible: true }), false);
});

test('a blurred or hidden window throttles; a focused visible window still paints', () => {
  const hidden = createFakeWindow({ focused: false, visible: false });
  assert.equal(applyWindowBackgroundThrottling(hidden), true);
  assert.equal(hidden.webContents.backgroundThrottling, true);
  assert.equal(isWindowPaintingAtFullRate(hidden), false);

  const blurred = createFakeWindow({ focused: false, visible: true });
  assert.equal(applyWindowBackgroundThrottling(blurred), true);
  assert.equal(blurred.webContents.backgroundThrottling, true);

  const minimized = createFakeWindow({ focused: true, visible: true, minimized: true });
  assert.equal(applyWindowBackgroundThrottling(minimized), true);
  assert.equal(minimized.webContents.backgroundThrottling, true);

  const focused = createFakeWindow({ focused: true, visible: true });
  assert.equal(applyWindowBackgroundThrottling(focused), false);
  assert.equal(focused.webContents.backgroundThrottling, false);
  assert.equal(isWindowPaintingAtFullRate(focused), true);
});

test('bindWindowBackgroundThrottling follows focus, blur, hide, and restore', () => {
  const win = createFakeWindow({ focused: false, visible: false });
  const changes = [];
  bindWindowBackgroundThrottling(win, {
    onChange: ({ throttling }) => changes.push(throttling),
  });
  assert.equal(win.webContents.backgroundThrottling, true);

  win.windowState.visible = true;
  win.windowState.focused = true;
  win.emit('focus');
  assert.equal(win.webContents.backgroundThrottling, false);

  win.windowState.focused = false;
  win.emit('blur');
  assert.equal(win.webContents.backgroundThrottling, true);

  win.windowState.focused = true;
  win.windowState.visible = false;
  win.emit('hide');
  assert.equal(win.webContents.backgroundThrottling, true);

  win.windowState.visible = true;
  win.emit('show');
  assert.equal(win.webContents.backgroundThrottling, false);

  assert.deepEqual(changes, [true, false, true, true, false]);
});

test('hidden-window tray repeater pushes the last snapshot only while no window paints', () => {
  const applied = [];
  let painting = false;
  let snapshot = { sessions: [{ id: 's1', status: 'idle' }] };
  const timers = [];
  const repeater = createHiddenWindowTrayRepeater({
    getLastSnapshot: () => snapshot,
    applySnapshot: (next) => applied.push(next),
    isAnyWindowPainting: () => painting,
    intervalMs: 5,
    setIntervalFn: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearIntervalFn: () => {
      timers.length = 0;
    },
  });

  repeater.sync();
  assert.equal(repeater.isRepeating(), true);
  assert.equal(applied.length, 0);
  timers[0]();
  assert.equal(applied.length, 1);
  assert.equal(applied[0], snapshot);

  painting = true;
  repeater.sync();
  assert.equal(repeater.isRepeating(), false);

  snapshot = { sessions: [{ id: 's1', status: 'busy' }] };
  painting = false;
  repeater.sync();
  timers[0]();
  assert.equal(applied.at(-1).sessions[0].status, 'busy');

  repeater.dispose();
  assert.equal(repeater.isRepeating(), false);
});

test('Desktop BrowserWindows default to Chromium throttling and bind lifecycle', () => {
  const source = fs.readFileSync(fileURLToPath(new URL('./main.mjs', import.meta.url)), 'utf8');
  assert.match(source, /bindWindowBackgroundThrottling/);
  assert.match(source, /createHiddenWindowTrayRepeater/);
  const forcedAwake = [...source.matchAll(/backgroundThrottling:\s*false/g)];
  assert.equal(
    forcedAwake.length,
    0,
    'windows must not keep the renderer fully awake while hidden',
  );
  const explicitDefault = [...source.matchAll(/backgroundThrottling:\s*true/g)];
  assert.equal(
    explicitDefault.length,
    2,
    'expected the main window and Mini Chat to default to backgroundThrottling: true',
  );
});
