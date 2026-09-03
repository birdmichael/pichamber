import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, mock, test } from 'bun:test';

const toastErrors: Array<{ title: string; description?: string }> = [];
const dialogOpenCalls: boolean[] = [];
const gitCheckCalls: string[] = [];
const generateBranchNameCalls: number[] = [];
const previewCalls: number[] = [];
const createWorktreeCalls: number[] = [];

let activeProject: { id: string; path: string } | null = {
  id: 'project-1',
  path: '/Users/tester/repo',
};
let isGitRepo = true;
let gitCheckShouldThrow = false;

mock.module('@/components/ui', () => ({
  toast: {
    error: (title: string, options?: { description?: string }) => {
      toastErrors.push({ title, description: options?.description });
    },
  },
}));

mock.module('@/sync/session-ui-store', () => ({
  useSessionUIStore: {
    getState: () => ({
      newSessionDraft: { open: false, target: 'chat' },
      availableWorktreesByProject: new Map(),
    }),
  },
}));

mock.module('@/stores/useProjectsStore', () => ({
  useProjectsStore: {
    getState: () => ({
      getActiveProject: () => activeProject,
      projects: activeProject ? [activeProject] : [],
    }),
  },
}));

mock.module('@/stores/useUIStore', () => ({
  useUIStore: {
    getState: () => ({
      setNewWorktreeDialogOpen: (open: boolean) => {
        dialogOpenCalls.push(open);
      },
    }),
  },
}));

mock.module('@/stores/useConfigStore', () => ({
  useConfigStore: {
    getState: () => ({
      agents: [],
      getVisibleAgents: () => [],
    }),
  },
}));

mock.module('@/stores/contextStore', () => ({
  useContextStore: {
    getState: () => ({}),
  },
}));

mock.module('@/stores/useDirectoryStore', () => ({
  useDirectoryStore: {
    getState: () => ({
      setDirectory: () => undefined,
    }),
  },
}));

mock.module('@/lib/gitApi', () => ({
  checkIsGitRepository: async (directory: string) => {
    gitCheckCalls.push(directory);
    if (gitCheckShouldThrow) {
      throw new Error('git check failed');
    }
    return isGitRepo;
  },
  previewGitWorktree: async () => {
    previewCalls.push(1);
    throw new Error('previewGitWorktree should not run for the dialog path');
  },
}));

mock.module('@/lib/git/branchNameGenerator', () => ({
  generateBranchName: () => {
    generateBranchNameCalls.push(1);
    throw new Error('generateBranchName should not run for the dialog path');
  },
}));

mock.module('@/lib/modelIdentifier', () => ({
  parseModelIdentifier: () => null,
}));

mock.module('@/lib/worktrees/worktreeStatus', () => ({
  getRootBranch: async () => 'main',
}));

mock.module('@/lib/openchamberConfig', () => ({
  getWorktreeSetupCommands: async () => [],
  getWorktreeSetupWaitEnabled: async () => false,
}));

mock.module('@/lib/worktrees/worktreeManager', () => ({
  removeProjectWorktree: async () => undefined,
}));

mock.module('@/lib/worktrees/worktreeCreate', () => ({
  createWorktreeWithDefaults: async () => {
    createWorktreeCalls.push(1);
    throw new Error('createWorktreeWithDefaults should not run for the dialog path');
  },
}));

mock.module('@/lib/worktrees/pendingDraftWorktree', () => ({
  createPendingDraftWorktreeRequest: () => 'pending-1',
  rejectPendingDraftWorktreeRequest: () => undefined,
  resolvePendingDraftWorktreeRequest: () => undefined,
}));

mock.module('@/lib/worktrees/worktreeBootstrap', () => ({
  waitForWorktreeBootstrap: async () => undefined,
}));

mock.module('@/lib/pathNormalization', () => ({
  normalizePath: (value: string | null | undefined) => value ?? '',
}));

mock.module('@/lib/projectResolution', () => ({
  resolveProjectForDirectory: () => null,
}));

const { openNewWorktreeDialog } = await import('./worktreeSessionCreator');

const readSource = (relativeFromThisFile: string): string => {
  return readFileSync(fileURLToPath(new URL(relativeFromThisFile, import.meta.url)), 'utf8');
};

beforeEach(() => {
  toastErrors.length = 0;
  dialogOpenCalls.length = 0;
  gitCheckCalls.length = 0;
  generateBranchNameCalls.length = 0;
  previewCalls.length = 0;
  createWorktreeCalls.length = 0;
  activeProject = { id: 'project-1', path: '/Users/tester/repo' };
  isGitRepo = true;
  gitCheckShouldThrow = false;
});

describe('openNewWorktreeDialog', () => {
  test('git project opens the shared dialog and does not create a worktree', async () => {
    expect(await openNewWorktreeDialog()).toBe(true);

    expect(gitCheckCalls).toEqual(['/Users/tester/repo']);
    expect(dialogOpenCalls).toEqual([true]);
    expect(toastErrors).toEqual([]);
    expect(generateBranchNameCalls).toEqual([]);
    expect(previewCalls).toEqual([]);
    expect(createWorktreeCalls).toEqual([]);
  });

  test('non-git project toasts and does not open the dialog', async () => {
    isGitRepo = false;

    expect(await openNewWorktreeDialog()).toBe(false);

    expect(dialogOpenCalls).toEqual([]);
    expect(generateBranchNameCalls).toEqual([]);
    expect(createWorktreeCalls).toEqual([]);
    expect(toastErrors).toEqual([
      {
        title: 'Not a Git repository',
        description: 'Worktrees can only be created in Git repositories.',
      },
    ]);
  });

  test('git check failure is treated as non-git', async () => {
    gitCheckShouldThrow = true;

    expect(await openNewWorktreeDialog()).toBe(false);

    expect(dialogOpenCalls).toEqual([]);
    expect(toastErrors).toEqual([
      {
        title: 'Not a Git repository',
        description: 'Worktrees can only be created in Git repositories.',
      },
    ]);
  });

  test('no active project toasts and does not open the dialog', async () => {
    activeProject = null;

    expect(await openNewWorktreeDialog()).toBe(false);

    expect(gitCheckCalls).toEqual([]);
    expect(dialogOpenCalls).toEqual([]);
    expect(toastErrors).toEqual([
      {
        title: 'No active project',
        description: 'Please select a project first.',
      },
    ]);
  });
});

describe('new-worktree callers', () => {
  test('File menu, shortcut, and command palette open the dialog, not an instant worktree', () => {
    const menu = readSource('../hooks/useMenuActions.ts');
    const shortcuts = readSource('../hooks/useKeyboardShortcuts.ts');
    const palette = readSource('../components/ui/CommandPalette.tsx');

    const menuCaseStart = menu.indexOf("case 'new-worktree-session':");
    const menuCase = menu.slice(menuCaseStart, menu.indexOf("case 'change-workspace':", menuCaseStart));
    expect(menuCase).toContain('void openNewWorktreeDialog()');
    expect(menuCase).not.toContain('createWorktreeSession');
    expect(menuCase).not.toContain('createInstantWorktreeDraft');
    expect(menu).toContain("import { openNewWorktreeDialog } from '@/lib/worktreeSessionCreator'");
    expect(menu).not.toContain('createWorktreeSession');

    const shortcutStart = shortcuts.indexOf('new_chat_worktree:');
    const shortcut = shortcuts.slice(shortcutStart, shortcuts.indexOf('cycle_theme:', shortcutStart));
    expect(shortcut).toContain('void openNewWorktreeDialog()');
    expect(shortcut).not.toContain('createWorktreeSession');
    expect(shortcut).not.toContain('createInstantWorktreeDraft');
    expect(shortcuts).toContain("import { openNewWorktreeDialog } from '@/lib/worktreeSessionCreator'");
    expect(shortcuts).not.toContain('createWorktreeSession');

    const paletteStart = palette.indexOf("id: 'new-worktree'");
    const paletteItem = palette.slice(paletteStart, palette.indexOf("id: 'add-project'", paletteStart));
    expect(paletteItem).toContain('void openNewWorktreeDialog()');
    expect(paletteItem).not.toContain('createWorktreeSession');
    expect(paletteItem).not.toContain('createInstantWorktreeDraft');
    expect(palette).toContain("import { openNewWorktreeDialog } from '@/lib/worktreeSessionCreator'");
    expect(palette).not.toContain('createWorktreeSession');
  });

  test('dialog opener sets the same store flag as the sidebar and does not create instantly', () => {
    const creator = readSource('./worktreeSessionCreator.ts');
    const openerStart = creator.indexOf('export async function openNewWorktreeDialog');
    const opener = creator.slice(openerStart, creator.indexOf('const applyDefaultAgentAndModelSelection', openerStart));

    expect(opener).toContain('setNewWorktreeDialogOpen(true)');
    expect(opener).not.toContain('createInstantWorktreeDraft');
    expect(opener).not.toContain('createQuickWorktree');
    expect(opener).not.toContain('generateBranchName');
  });

  test('sidebar New worktree still opens the dialog store flag', () => {
    const sidebar = readSource('../components/session/SessionSidebar.tsx');
    expect(sidebar).toMatch(
      /const openNewWorktreeDialog = React\.useCallback\(\(\) => \{[\s\S]*?setNewWorktreeDialogOpen\(true\);/,
    );
    expect(sidebar).not.toContain('createWorktreeSession');
    expect(sidebar).not.toContain('createInstantWorktreeDraft');
  });

  test('composer branch New remains the instant draft path', () => {
    const composer = readSource('../components/chat/composer/ui/DraftTargetSelectors.tsx');
    expect(composer).toContain('void createWorktreeDraft()');
    expect(composer).not.toContain('openNewWorktreeDialog');
    expect(composer).not.toContain('setNewWorktreeDialogOpen');
  });
});
