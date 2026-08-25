import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'BranchSelector.tsx'),
  'utf8',
);

describe('multi-run branch selector loading', () => {
  test('loading uses a skeleton instead of a branch-like placeholder sentence', () => {
    expect(source).toContain('<Skeleton');
    expect(source).toContain('aria-busy={isLoading}');
    expect(source).not.toContain(
      "placeholder={isLoading ? t('multiRun.branchSelector.status.loadingBranches')",
    );
    expect(source).toContain(
      "<SelectValue placeholder={t('multiRun.branchSelector.placeholder.selectSourceBranch')} />",
    );
  });
});
