import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'bun:test';

describe('ModelPickerList Escape', () => {
  test('closes from the list root and from a focused model row', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'ModelPickerList.tsx'),
      'utf-8',
    );
    expect(source).toContain('data-model-picker-list');
    expect(source).toContain('onKeyDown={handleKeyDown}');
    expect(source).toMatch(/role="option"[\s\S]*handleKeyDown\(event\)/);
    expect(source).toContain("if (event.key === 'Escape')");
  });
});
