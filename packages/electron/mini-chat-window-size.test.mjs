import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  isLinuxMiniChatWorkAreaMaximized,
  resolveMiniChatMaximizedBounds,
  resolveMiniChatMinimumSize,
  resolveMiniChatWindowSize,
} from './mini-chat-window-size.mjs';

const PREFERRED = { width: 520, height: 640 };
const MIN_SIZE = { width: 360, height: 480 };

const assertFullyInside = (bounds, workArea) => {
  assert.ok(bounds.x >= workArea.x);
  assert.ok(bounds.y >= workArea.y);
  assert.ok(bounds.x + bounds.width <= workArea.x + workArea.width);
  assert.ok(bounds.y + bounds.height <= workArea.y + workArea.height);
};

test('800px work area keeps preferred 520×640 fully inside with composer room', () => {
  const workArea = { x: 0, y: 0, width: 1280, height: 800 };
  const next = resolveMiniChatWindowSize({ workArea, preferred: PREFERRED, minSize: MIN_SIZE });
  assert.equal(next.width, 520);
  assert.equal(next.height, 640);
  assertFullyInside(next, workArea);
});

test('743px docked work area keeps preferred 640h fully inside', () => {
  const workArea = { x: 0, y: 0, width: 1280, height: 743 };
  const next = resolveMiniChatWindowSize({ workArea, preferred: PREFERRED, minSize: MIN_SIZE });
  assert.equal(next.width, 520);
  assert.equal(next.height, 640);
  assertFullyInside(next, workArea);
});

test('work area shorter than preferred clamps height to the work area', () => {
  const workArea = { x: 0, y: 0, width: 1280, height: 600 };
  const next = resolveMiniChatWindowSize({ workArea, preferred: PREFERRED, minSize: MIN_SIZE });
  assert.equal(next.width, 520);
  assert.equal(next.height, 600);
  assert.equal(next.y, 0);
  assertFullyInside(next, workArea);
});

test('work area smaller than minSize uses the work area', () => {
  const workArea = { x: 10, y: 20, width: 300, height: 400 };
  const next = resolveMiniChatWindowSize({ workArea, preferred: PREFERRED, minSize: MIN_SIZE });
  assert.deepEqual(next, { x: 10, y: 20, width: 300, height: 400 });
});

test('missing workArea returns preferred at least 1×1', () => {
  assert.deepEqual(
    resolveMiniChatWindowSize({ workArea: null, preferred: PREFERRED, minSize: MIN_SIZE }),
    { width: 520, height: 640 },
  );
  assert.deepEqual(
    resolveMiniChatWindowSize({ preferred: { width: 0, height: -4 } }),
    { width: 1, height: 1 },
  );
});

test('resolveMiniChatMaximizedBounds rounds the work area or returns null', () => {
  assert.deepEqual(
    resolveMiniChatMaximizedBounds({ x: 0.4, y: 1.6, width: 1280.2, height: 743.4 }),
    { x: 0, y: 2, width: 1280, height: 743 },
  );
  assert.equal(resolveMiniChatMaximizedBounds(null), null);
  assert.equal(resolveMiniChatMaximizedBounds({ width: 0, height: 800 }), null);
});

test('resolveMiniChatMinimumSize does not exceed a short work area', () => {
  assert.deepEqual(
    resolveMiniChatMinimumSize({ workArea: { width: 1280, height: 400 }, minSize: MIN_SIZE }),
    { width: 360, height: 400 },
  );
  assert.deepEqual(
    resolveMiniChatMinimumSize({ workArea: null, minSize: MIN_SIZE }),
    MIN_SIZE,
  );
});

test('Linux Mini Chat work-area fill is treated as maximized', () => {
  assert.equal(isLinuxMiniChatWorkAreaMaximized({ __ocMiniChat: true, __ocMiniChatFilledWorkArea: true }, 'linux'), true);
  assert.equal(isLinuxMiniChatWorkAreaMaximized({ __ocMiniChat: true, __ocMiniChatFilledWorkArea: true }, 'darwin'), false);
  assert.equal(isLinuxMiniChatWorkAreaMaximized({ __ocMiniChat: true }, 'linux'), false);
  assert.equal(isLinuxMiniChatWorkAreaMaximized({ __ocMiniChatFilledWorkArea: true }, 'linux'), false);
});

test('main.mjs wires Mini Chat preferred height 640 and size clamp', () => {
  const source = readFileSync(fileURLToPath(new URL('./main.mjs', import.meta.url)), 'utf8');
  assert.match(source, /MINI_CHAT_WINDOW_HEIGHT = 640/);
  assert.match(source, /resolveMiniChatWindowSize/);
  assert.match(source, /resolveMiniChatMaximizedBounds/);
  assert.match(source, /__ocMiniChatFilledWorkArea/);
  assert.match(source, /isLinuxMiniChatWorkAreaMaximized/);
  assert.match(
    source,
    /titleBarStyle: process\.platform === 'darwin'\s*\? 'hidden'\s*: process\.platform === 'win32'\s*\? 'hidden'\s*: 'default'/,
  );
});
