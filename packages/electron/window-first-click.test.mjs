import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('Desktop windows accept the first click while unfocused', () => {
  const source = fs.readFileSync(fileURLToPath(new URL('./main.mjs', import.meta.url)), 'utf8');
  const acceptFirstMouse = [...source.matchAll(/acceptFirstMouse:\s*true/g)];
  assert.equal(
    acceptFirstMouse.length,
    2,
    'expected the main window and Mini Chat to accept the first mouse click',
  );
  assert.match(source, /registerAccelerator:\s*false/);
  assert.match(source, /accelerator: 'Cmd\+N'/);
});
