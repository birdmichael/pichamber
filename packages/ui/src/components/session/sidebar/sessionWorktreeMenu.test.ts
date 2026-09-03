import { describe, expect, test } from 'bun:test';
import type { WorktreeMetadata } from '@/types/worktree';
import {
  buildSessionWorktreeMenuTargets,
} from './sessionWorktreeMenu';

const worktree = (overrides: Partial<WorktreeMetadata> = {}): WorktreeMetadata => ({
  path: '/repo-feature',
  projectDirectory: '/repo',
  branch: 'feature',
  label: 'feature',
  name: 'feature',
  worktreeStatus: 'ready',
  worktreeSource: 'existing',
  ...overrides,
});

describe('buildSessionWorktreeMenuTargets', () => {
  test('adds the canonical main worktree, includes the current source, dedupes by path, and sorts linked targets', () => {
    const targets = buildSessionWorktreeMenuTargets({
      projectPath: '/repo-linked',
      discoveredWorktrees: [
        worktree({ path: '/repo-zebra', branch: 'zebra', label: 'zebra', name: 'zebra' }),
        worktree({ path: '/repo-alpha', branch: 'alpha', label: 'alpha', name: 'alpha' }),
        worktree({ path: '/repo-current', branch: 'current', label: 'current', name: 'current' }),
        worktree({ path: '/repo-alpha/', branch: 'alpha', label: 'alpha duplicate', name: 'alpha-duplicate' }),
      ],
      sourceDirectory: '/repo-current/',
      currentWorktree: worktree({
        path: '/repo-current',
        projectDirectory: '/repo',
        branch: 'current',
        label: 'Current branch',
      }),
    });

    expect(targets.map((target) => ({
      path: target.metadata.path,
      isPrimary: target.isPrimary,
      isCurrent: target.isCurrent,
    }))).toEqual([
      { path: '/repo', isPrimary: true, isCurrent: false },
      { path: '/repo-alpha', isPrimary: false, isCurrent: false },
      { path: '/repo-current', isPrimary: false, isCurrent: true },
      { path: '/repo-zebra', isPrimary: false, isCurrent: false },
    ]);
    expect(targets[0]?.metadata.worktreeStatus).toBe('ready');
    expect(targets[0]?.metadata.worktreeSource).toBe('existing');
  });

  test('prefers discovered primary metadata instead of synthetic fallback metadata', () => {
    const targets = buildSessionWorktreeMenuTargets({
      projectPath: '/repo-linked',
      discoveredWorktrees: [
        worktree({
          path: '/repo',
          projectDirectory: '/repo',
          branch: 'main',
          label: 'main',
          name: 'repo-primary',
          headState: 'branch',
        }),
      ],
      sourceDirectory: '/repo-linked',
      currentWorktree: worktree({
        path: '/repo-linked',
        projectDirectory: '/repo',
        branch: 'feature',
        label: 'feature',
      }),
    });

    expect(targets[0]?.isPrimary).toBe(true);
    expect(targets[0]?.metadata.path).toBe('/repo');
    expect(targets[0]?.metadata.branch).toBe('main');
    expect(targets[0]?.metadata.label).toBe('main');
    expect(targets[0]?.metadata.name).toBe('repo-primary');
    expect(targets[0]?.metadata.headState).toBe('branch');
  });

  test('sorts linked targets by effective compact label when branch is missing', () => {
    const targets = buildSessionWorktreeMenuTargets({
      projectPath: '/repo',
      discoveredWorktrees: [
        worktree({ path: '/repo-zed', branch: '', label: '', name: 'zed' }),
        worktree({ path: '/repo-alpha', branch: '', label: '', name: 'alpha' }),
        worktree({ path: '/repo-beta', branch: 'beta', label: 'beta', name: 'beta' }),
      ],
      sourceDirectory: '/repo-current',
      currentWorktree: worktree({ path: '/repo-current', projectDirectory: '/repo', branch: '', label: '', name: 'current' }),
    });

    expect(targets.map((target) => target.metadata.path)).toEqual([
      '/repo',
      '/repo-alpha',
      '/repo-beta',
      '/repo-current',
      '/repo-zed',
    ]);
  });

  test('uses the owning project root branch for a synthetic primary when git omits the queried checkout', () => {
    const targets = buildSessionWorktreeMenuTargets({
      projectPath: '/repo',
      discoveredWorktrees: [
        worktree({ path: '/repo-feature', projectDirectory: '/repo', branch: 'feature', label: 'feature' }),
      ],
      sourceDirectory: '/repo-feature',
      currentWorktree: worktree({ path: '/repo-feature', projectDirectory: '/repo', branch: 'feature', label: 'feature' }),
      projectRootBranch: 'main',
    });

    expect(targets[0]?.isPrimary).toBe(true);
    expect(targets[0]?.metadata.path).toBe('/repo');
    expect(targets[0]?.metadata.branch).toBe('main');
    expect(targets[0]?.metadata.label).toBe('main');
    expect(targets[0]?.metadata.headState).toBe('branch');
  });
});
