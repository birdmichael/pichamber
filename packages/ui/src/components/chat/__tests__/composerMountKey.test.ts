import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const chatContainerSource = readFileSync(join(here, '../ChatContainer.tsx'), 'utf8');

describe('composer mount isolation', () => {
  test('every ChatInput mount is keyed by session or new-session draft', () => {
    const mounts = [...chatContainerSource.matchAll(/<ChatInput\b[^>]*>/g)].map((match) => match[0]);
    expect(mounts.length).toBeGreaterThanOrEqual(4);
    for (const mount of mounts) {
      expect(mount).toContain('key={composerMountKey}');
    }
  });
});
