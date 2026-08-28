import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'runtimeEndpointReset.ts'),
  'utf-8',
);

describe('runtimeEndpointReset', () => {
  test('clears xAI usage so a runtime switch cannot keep the previous snapshot', () => {
    expect(source).toContain('useXaiUsageStore.getState().reset()');
  });
});
