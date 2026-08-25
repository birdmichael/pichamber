import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const read = (relativePath: string) => readFileSync(join(here, relativePath), 'utf8');

describe('Git panel loading chrome', () => {
  test('fallback is a skeleton, not an empty pane', () => {
    const source = read('GitViewFallback.tsx');
    expect(source).toContain('<Skeleton');
    expect(source).toContain('aria-busy="true"');
    expect(source).toContain("t('gitView.loading.checkingRepository')");
  });

  test('desktop Git surfaces use the fallback while the chunk or status loads', () => {
    const contextPanel = read('../layout/ContextPanel.tsx');
    const mainLayout = read('../layout/MainLayout.tsx');
    const gitView = read('GitView.tsx');

    expect(contextPanel).toContain(
      '<React.Suspense fallback={<GitViewFallback />}><GitView isActive={isOpen} /></React.Suspense>',
    );
    expect(mainLayout).toContain(
      '<React.Suspense fallback={<GitViewFallback />}><GitView isActive={!mobileRightSidebarOpen} /></React.Suspense>',
    );
    expect(mainLayout).toContain(
      '<React.Suspense fallback={<GitViewFallback />}><GitView isActive={mobileRightSidebarOpen} /></React.Suspense>',
    );
    expect(gitView).toContain('<GitViewFallback />');
  });
});
