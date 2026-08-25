import { expect, test } from 'bun:test';

import { isSharedEscMainSurface, shouldCloseMainSurfaceOnEscape } from './main-surface-dismiss';

const closed = {
  isArchivePageOpen: false,
  isScheduledTasksDialogOpen: false,
  worktreesPageProjectId: null,
  isMultiRunLauncherOpen: false,
  multiRunCompareGroup: null,
};

test('Esc closes Archive, Scheduled, and Worktrees', () => {
  expect(shouldCloseMainSurfaceOnEscape({ ...closed, isArchivePageOpen: true })).toBe(true);
  expect(shouldCloseMainSurfaceOnEscape({ ...closed, isScheduledTasksDialogOpen: true })).toBe(true);
  expect(shouldCloseMainSurfaceOnEscape({ ...closed, worktreesPageProjectId: 'proj_1' })).toBe(true);
});

test('Esc does not close Multi-run launcher or compare', () => {
  expect(shouldCloseMainSurfaceOnEscape({ ...closed, isMultiRunLauncherOpen: true })).toBe(false);
  expect(shouldCloseMainSurfaceOnEscape({ ...closed, multiRunCompareGroup: { title: 'run' } })).toBe(false);
  expect(isSharedEscMainSurface({
    ...closed,
    isArchivePageOpen: true,
    isMultiRunLauncherOpen: true,
  })).toBe(false);
});

test('nested picker or dialog wins the first Esc', () => {
  expect(shouldCloseMainSurfaceOnEscape({ ...closed, isArchivePageOpen: true }, true)).toBe(false);
  expect(shouldCloseMainSurfaceOnEscape({ ...closed, isScheduledTasksDialogOpen: true }, true)).toBe(false);
});

test('Esc does nothing when no main surface is open', () => {
  expect(shouldCloseMainSurfaceOnEscape(closed)).toBe(false);
});
