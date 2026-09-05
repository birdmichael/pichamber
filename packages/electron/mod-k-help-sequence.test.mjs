import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  MOD_K_HELP_LEADER_TIMEOUT_MS,
  createModKHelpSequenceTracker,
} from './mod-k-help-sequence.mjs';

const keyDown = (partial) => ({ type: 'keyDown', ...partial });

test('arms on Ctrl+K without preventing default', () => {
  const tracker = createModKHelpSequenceTracker();
  const result = tracker.handleInput(keyDown({ key: 'k', code: 'KeyK', control: true }), 1_000);
  assert.deepEqual(result, { preventDefault: false, fireHelp: false, armed: true });
  assert.equal(tracker.isArmed(1_000), true);
});

test('arms on Cmd+K (meta) the same way', () => {
  const tracker = createModKHelpSequenceTracker();
  const result = tracker.handleInput(keyDown({ key: 'k', code: 'KeyK', meta: true }), 1_000);
  assert.equal(result.armed, true);
  assert.equal(result.preventDefault, false);
});

test('completing with H while armed prevents insert and fires help', () => {
  const tracker = createModKHelpSequenceTracker();
  tracker.handleInput(keyDown({ key: 'k', code: 'KeyK', control: true }), 1_000);
  const result = tracker.handleInput(keyDown({ key: 'h', code: 'KeyH' }), 1_100);
  assert.deepEqual(result, { preventDefault: true, fireHelp: true, armed: false });
  assert.equal(tracker.isArmed(1_100), false);
});

test('Shift+H also completes help while armed', () => {
  const tracker = createModKHelpSequenceTracker();
  tracker.handleInput(keyDown({ key: 'k', code: 'KeyK', control: true }), 1_000);
  const result = tracker.handleInput(keyDown({ key: 'H', code: 'KeyH', shift: true }), 1_100);
  assert.equal(result.fireHelp, true);
  assert.equal(result.preventDefault, true);
});

test('does not fire help after the leader timeout', () => {
  const tracker = createModKHelpSequenceTracker({ timeoutMs: MOD_K_HELP_LEADER_TIMEOUT_MS });
  tracker.handleInput(keyDown({ key: 'k', code: 'KeyK', control: true }), 1_000);
  const result = tracker.handleInput(
    keyDown({ key: 'h', code: 'KeyH' }),
    1_000 + MOD_K_HELP_LEADER_TIMEOUT_MS + 1,
  );
  assert.deepEqual(result, { preventDefault: false, fireHelp: false, armed: false });
});

test('other second keys disarm without preventing default', () => {
  const tracker = createModKHelpSequenceTracker();
  tracker.handleInput(keyDown({ key: 'k', code: 'KeyK', control: true }), 1_000);
  const result = tracker.handleInput(keyDown({ key: 'p', code: 'KeyP' }), 1_100);
  assert.deepEqual(result, { preventDefault: false, fireHelp: false, armed: false });
  const lateH = tracker.handleInput(keyDown({ key: 'h', code: 'KeyH' }), 1_200);
  assert.equal(lateH.fireHelp, false);
});

test('ignores keyUp', () => {
  const tracker = createModKHelpSequenceTracker();
  tracker.handleInput(keyDown({ key: 'k', code: 'KeyK', control: true }), 1_000);
  const up = tracker.handleInput({ type: 'keyUp', key: 'k', code: 'KeyK', control: true }, 1_050);
  assert.equal(up.armed, true);
  assert.equal(up.fireHelp, false);
});

test('Ctrl+H while armed is not the bare-h help completion', () => {
  const tracker = createModKHelpSequenceTracker();
  tracker.handleInput(keyDown({ key: 'k', code: 'KeyK', control: true }), 1_000);
  const result = tracker.handleInput(keyDown({ key: 'h', code: 'KeyH', control: true }), 1_100);
  assert.equal(result.fireHelp, false);
  assert.equal(result.preventDefault, false);
});

test('main.mjs wires before-input help fallback on BrowserWindows', () => {
  const source = fs.readFileSync(fileURLToPath(new URL('./main.mjs', import.meta.url)), 'utf8');
  assert.match(source, /attachModKHelpSequenceFallback/);
  assert.match(source, /attachHelpShortcutFallback\(browserWindow\)/);
  assert.match(source, /emitToWindow\(browserWindow, 'openchamber:menu-action', 'help-dialog'\)/);
  assert.equal((source.match(/attachHelpShortcutFallback\(browserWindow\)/g) || []).length, 2);
});
