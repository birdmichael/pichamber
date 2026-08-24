import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dialogSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'dialog.tsx'),
  'utf-8',
);

describe('dialog sentence case', () => {
  test('dialog popups keep locale sentence case on buttons outside the footer', () => {
    const popupClassBlock = dialogSource.slice(
      dialogSource.indexOf('data-slot="dialog-content"'),
      dialogSource.indexOf('data-slot="dialog-header"'),
    );
    expect(popupClassBlock).toContain('[&_[data-slot=button]]:normal-case');
  });
});
