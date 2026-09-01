import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useConfigStore } from './useConfigStore';
import { useDirectoryStore } from './useDirectoryStore';
import { useUIStore } from './useUIStore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const uiStoreSource = readFileSync(join(__dirname, 'useUIStore.ts'), 'utf-8');

describe('useUIStore boot graph', () => {
  test('importing the chrome boot stores does not throw TDZ', () => {
    expect(useDirectoryStore.getState()).toBeDefined();
    expect(useConfigStore.getState()).toBeDefined();
    expect(useUIStore.getState()).toBeDefined();
  });

  test('useUIStore does not statically import directory, projects, or session-ui stores', () => {
    expect(uiStoreSource).not.toMatch(/import\s*\{[^}]*\buseDirectoryStore\b/);
    expect(uiStoreSource).not.toMatch(/import\s*\{[^}]*\buseProjectsStore\b/);
    expect(uiStoreSource).not.toMatch(/from\s+['"]@\/sync\/session-ui-store['"]/);
  });
});
