import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  decorateMenuTemplateForPlatform,
  formatNativeMenuAcceleratorForDisplay,
} from './menu-accelerators.mjs';

test('formats comma and period accelerators for display', () => {
  assert.equal(formatNativeMenuAcceleratorForDisplay('Ctrl+,'), 'Ctrl+,');
  assert.equal(formatNativeMenuAcceleratorForDisplay('Ctrl+Comma'), 'Ctrl+,');
  assert.equal(formatNativeMenuAcceleratorForDisplay('Ctrl+.'), 'Ctrl+.');
  assert.equal(formatNativeMenuAcceleratorForDisplay('Ctrl+Period'), 'Ctrl+.');
  assert.equal(formatNativeMenuAcceleratorForDisplay('Ctrl+P'), 'Ctrl+P');
});

test('Linux header menu shows Ctrl+, instead of Ctrl+Comma', () => {
  const decorated = decorateMenuTemplateForPlatform([
    {
      label: 'Pichamber',
      submenu: [
        { label: 'Settings', accelerator: 'Ctrl+,', click: () => {} },
        { label: 'Command Palette', accelerator: 'Ctrl+P', click: () => {} },
        { label: 'Keyboard Shortcuts', accelerator: 'Ctrl+.', click: () => {} },
      ],
    },
  ], 'linux');

  assert.equal(decorated[0].submenu[0].label, 'Settings\tCtrl+,');
  assert.equal(decorated[0].submenu[0].accelerator, undefined);
  assert.equal(decorated[0].submenu[0].registerAccelerator, false);
  assert.equal(decorated[0].submenu[1].label, 'Command Palette');
  assert.equal(decorated[0].submenu[1].accelerator, 'Ctrl+P');
  assert.equal(decorated[0].submenu[2].label, 'Keyboard Shortcuts\tCtrl+.');
});

test('macOS and Windows keep the source accelerator on the item', () => {
  const template = [{ label: 'Settings', accelerator: 'Ctrl+,' }];
  assert.deepEqual(decorateMenuTemplateForPlatform(template, 'darwin'), template);
  assert.deepEqual(decorateMenuTemplateForPlatform(template, 'win32'), template);
});

test('File New Session keeps Cmd+N / Ctrl+N as a hint and does not register it', () => {
  const source = fs.readFileSync(fileURLToPath(new URL('./main.mjs', import.meta.url)), 'utf8');
  const items = [...source.matchAll(/\{ label: 'New Session', accelerator: '(Cmd\+N|Ctrl\+N)'[^}]*\}/g)]
    .map((match) => match[0]);

  assert.equal(items.length, 2, 'expected darwin Cmd+N and Linux/Windows Ctrl+N New Session items');
  assert.ok(items.some((item) => item.includes("accelerator: 'Cmd+N'")));
  assert.ok(items.some((item) => item.includes("accelerator: 'Ctrl+N'")));
  for (const item of items) {
    assert.match(item, /registerAccelerator:\s*false/);
  }
});
