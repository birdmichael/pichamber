import { beforeEach, describe, expect, test } from 'bun:test';

import { useUIStore } from './useUIStore';

const clearSurfaces = {
  isScheduledTasksDialogOpen: false,
  isArchivePageOpen: false,
  worktreesPageProjectId: null,
  isMultiRunLauncherOpen: false,
  multiRunLauncherPrefillPrompt: '',
  multiRunCompareGroup: null,
};

beforeEach(() => {
  useUIStore.setState(clearSurfaces);
});

describe('closeMainSurfaces', () => {
  test('clears Archive and leaves the previous session flags alone', () => {
    useUIStore.setState({ isArchivePageOpen: true });
    useUIStore.getState().closeMainSurfaces();
    expect(useUIStore.getState().isArchivePageOpen).toBe(false);
  });

  test('clears Scheduled Tasks', () => {
    useUIStore.setState({ isScheduledTasksDialogOpen: true });
    useUIStore.getState().closeMainSurfaces();
    expect(useUIStore.getState().isScheduledTasksDialogOpen).toBe(false);
  });

  test('clears Worktrees', () => {
    useUIStore.setState({ worktreesPageProjectId: 'proj_1' });
    useUIStore.getState().closeMainSurfaces();
    expect(useUIStore.getState().worktreesPageProjectId).toBe(null);
  });

  test('clears every main-surface flag together', () => {
    useUIStore.setState({
      isArchivePageOpen: true,
      isScheduledTasksDialogOpen: true,
      worktreesPageProjectId: 'proj_1',
      isMultiRunLauncherOpen: true,
      multiRunLauncherPrefillPrompt: 'hello',
      multiRunCompareGroup: {
        groupSlug: 'g',
        runGroup: 'r',
        title: 'compare',
        sessionIds: ['ses_1'],
      },
    });
    useUIStore.getState().closeMainSurfaces();
    expect(useUIStore.getState()).toMatchObject(clearSurfaces);
  });

  test('is a no-op when no main surface is open', () => {
    const before = useUIStore.getState();
    useUIStore.getState().closeMainSurfaces();
    expect(useUIStore.getState()).toBe(before);
  });
});
