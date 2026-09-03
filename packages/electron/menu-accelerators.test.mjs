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
  assert.equal(formatNativeMenuAcceleratorForDisplay('Ctrl+K, H'), 'Ctrl+K, H');
  assert.equal(formatNativeMenuAcceleratorForDisplay('Cmd+K, H'), 'Cmd+K, H');
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

test('sequential catalog chords are shown in the label column on every platform', () => {
  const template = [
    { label: 'Keyboard Shortcuts', accelerator: 'Ctrl+K, H', registerAccelerator: false, click: () => {} },
  ];

  for (const platform of ['linux', 'darwin', 'win32']) {
    const decorated = decorateMenuTemplateForPlatform(template, platform);
    assert.equal(decorated[0].label, 'Keyboard Shortcuts\tCtrl+K, H', platform);
    assert.equal(decorated[0].accelerator, undefined, platform);
    assert.equal(decorated[0].registerAccelerator, false, platform);
  }

  const mac = decorateMenuTemplateForPlatform(
    [{ label: 'Keyboard Shortcuts', accelerator: 'Cmd+K, H', registerAccelerator: false, click: () => {} }],
    'darwin',
  );
  assert.equal(mac[0].label, 'Keyboard Shortcuts\tCmd+K, H');
  assert.equal(mac[0].accelerator, undefined);
  assert.equal(mac[0].registerAccelerator, false);
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

test('Command Palette keeps Cmd+P / Ctrl+P as a hint and does not register it', () => {
  const source = fs.readFileSync(fileURLToPath(new URL('./main.mjs', import.meta.url)), 'utf8');
  const items = [...source.matchAll(/\{ label: 'Command Palette', accelerator: '(Cmd\+P|Ctrl\+P)'[^}]*\}/g)]
    .map((match) => match[0]);

  assert.equal(items.length, 2, 'expected darwin Cmd+P and Linux/Windows Ctrl+P Command Palette items');
  assert.ok(items.some((item) => item.includes("accelerator: 'Cmd+P'")));
  assert.ok(items.some((item) => item.includes("accelerator: 'Ctrl+P'")));
  for (const item of items) {
    assert.match(item, /registerAccelerator:\s*false/);
  }
});

test('Help Keyboard Shortcuts advertises Cmd+K, H / Ctrl+K, H and does not register it', () => {
  const source = fs.readFileSync(fileURLToPath(new URL('./main.mjs', import.meta.url)), 'utf8');
  const items = [...source.matchAll(/\{ label: 'Keyboard Shortcuts', accelerator: '(Cmd\+K, H|Ctrl\+K, H)'[^}]*\}/g)]
    .map((match) => match[0]);

  assert.equal(items.length, 2, 'expected darwin Cmd+K, H and Linux/Windows Ctrl+K, H Keyboard Shortcuts items');
  assert.ok(items.some((item) => item.includes("accelerator: 'Cmd+K, H'")));
  assert.ok(items.some((item) => item.includes("accelerator: 'Ctrl+K, H'")));
  for (const item of items) {
    assert.match(item, /registerAccelerator:\s*false/);
  }
  assert.equal(
    [...source.matchAll(/label: 'Keyboard Shortcuts', accelerator: 'Cmd\+\.'/g)].length,
    0,
    'leftover Cmd+. must not be advertised on Keyboard Shortcuts',
  );
  assert.equal(
    [...source.matchAll(/label: 'Keyboard Shortcuts', accelerator: 'Ctrl\+\.'/g)].length,
    0,
    'leftover Ctrl+. must not be advertised on Keyboard Shortcuts',
  );
});

const readConstArrowFn = (source, name) => {
  const match = source.match(new RegExp(`const ${name} = \\([^)]*\\) => \\{([\\s\\S]*?)\\n\\};`));
  assert.ok(match, `expected ${name}`);
  return match[1];
};

test('Command Palette and Keyboard Shortcuts menu clicks are single-delivery', () => {
  const source = fs.readFileSync(fileURLToPath(new URL('./main.mjs', import.meta.url)), 'utf8');

  const dual = readConstArrowFn(source, 'dispatchMenuAction');
  assert.match(dual, /emitToWindow\(/);
  assert.match(dual, /dispatchDomEventToWindow\(/);

  const once = readConstArrowFn(source, 'dispatchMenuActionOnce');
  assert.match(once, /emitToWindow\(/);
  assert.doesNotMatch(once, /dispatchDomEventToWindow/);
  assert.equal([...once.matchAll(/emitToWindow\(/g)].length, 1);

  const paletteItems = [...source.matchAll(/\{ label: 'Command Palette'[^}]*\}/g)].map((match) => match[0]);
  assert.equal(paletteItems.length, 2, 'expected darwin and Linux/Windows Command Palette items');
  for (const item of paletteItems) {
    assert.match(item, /click: \(\) => dispatchMenuActionOnce\('command-palette'\)/);
    assert.doesNotMatch(item, /dispatchAction\(/);
    assert.doesNotMatch(item, /dispatchMenuAction\(/);
  }

  const helpItems = [...source.matchAll(/\{ label: 'Keyboard Shortcuts'[^}]*\}/g)].map((match) => match[0]);
  assert.equal(helpItems.length, 2, 'expected darwin and Linux/Windows Keyboard Shortcuts items');
  for (const item of helpItems) {
    assert.match(item, /click: \(\) => dispatchMenuActionOnce\('help-dialog'\)/);
    assert.doesNotMatch(item, /dispatchAction\(/);
    assert.doesNotMatch(item, /dispatchMenuAction\(/);
  }
});
