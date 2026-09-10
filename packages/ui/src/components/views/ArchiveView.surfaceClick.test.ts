import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const archiveSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'ArchiveView.tsx'),
  'utf8',
);

const layoutSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../layout/MainLayout.tsx'),
  'utf8',
);

const sessionActionsSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../session/sidebar/hooks/useSessionActions.ts'),
  'utf8',
);

describe('Archive surface first-click after dismiss (#682)', () => {
  test('ArchiveView fills main with absolute inset-0 z-10 like Scheduled/Worktrees', () => {
    expect(archiveSource).toContain('absolute inset-0 z-10 flex flex-col bg-background');
  });

  test('MainLayout force-closes hover tooltips when a surface page closes', () => {
    expect(layoutSource).toContain('forceCloseAllHoverTooltips');
    expect(layoutSource).toContain('wasSurfacePageOpenRef');
  });

  test('session select force-closes tooltips when leaving a surface', () => {
    expect(sessionActionsSource).toContain('forceCloseAllHoverTooltips');
    expect(sessionActionsSource).toContain('leavingSurface');
  });
});

const tooltipPressSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../ui/tooltip-press.ts'),
  'utf8',
);

describe('forceCloseAllHoverTooltips export', () => {
  test('tooltip-press exports forceCloseAllHoverTooltips for surface dismiss', () => {
    expect(tooltipPressSource).toContain('export function forceCloseAllHoverTooltips');
  });
});
