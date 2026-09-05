import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';

import {
  mapInheritedNewSessionDraftToMiniChatArgs,
  mapOpenNewSessionDraftToMiniChatArgs,
  resolveInheritedNewSessionDraftOptions,
} from './newSessionInherit';

const homeDirectory = '/Users/tester';
const projectPath = '/Users/tester/project';
const worktreePath = '/Users/tester/project/.worktrees/feature';
const chatDirectory = '/Users/tester/.config/openchamber/chats/2026-08-25/session-a';
const openedProjectPaths = [projectPath];

describe('resolveInheritedNewSessionDraftOptions', () => {
  test('project session → directoryOverride', () => {
    expect(resolveInheritedNewSessionDraftOptions({
      currentSessionId: 'ses_project',
      currentSessionDirectory: projectPath,
      homeDirectory,
      openedProjectPaths,
      activeProjectId: 'other-project',
      activeProjectPath: '/Users/tester/other',
    })).toEqual({ directoryOverride: projectPath });
  });

  test('project worktree session → that directory, not the active project root', () => {
    expect(resolveInheritedNewSessionDraftOptions({
      currentSessionId: 'ses_worktree',
      currentSessionDirectory: worktreePath,
      homeDirectory,
      openedProjectPaths,
      activeProjectId: 'project-1',
      activeProjectPath: projectPath,
    })).toEqual({ directoryOverride: worktreePath });
  });

  test('active project only → selectedProjectId', () => {
    expect(resolveInheritedNewSessionDraftOptions({
      currentSessionId: null,
      currentSessionDirectory: null,
      homeDirectory,
      openedProjectPaths,
      activeProjectId: 'project-1',
      activeProjectPath: projectPath,
    })).toEqual({
      selectedProjectId: 'project-1',
      directoryOverride: projectPath,
    });
  });

  test('no project → undefined/chat', () => {
    expect(resolveInheritedNewSessionDraftOptions({
      currentSessionId: null,
      currentSessionDirectory: null,
      homeDirectory,
      openedProjectPaths: [],
      activeProjectId: null,
      activeProjectPath: null,
    })).toBe(undefined);
  });

  test('managed-chat current session stays projectless even with leftover active project', () => {
    expect(resolveInheritedNewSessionDraftOptions({
      currentSessionId: 'ses_chat',
      currentSessionDirectory: chatDirectory,
      homeDirectory,
      openedProjectPaths,
      activeProjectId: 'project-1',
      activeProjectPath: projectPath,
    })).toBe(undefined);
  });

  test('managed-chat current session and no active project → undefined/chat', () => {
    expect(resolveInheritedNewSessionDraftOptions({
      currentSessionId: 'ses_chat',
      currentSessionDirectory: chatDirectory,
      homeDirectory,
      openedProjectPaths,
      activeProjectId: null,
      activeProjectPath: null,
    })).toBe(undefined);
  });

  test('home is a project session when that folder is an opened project', () => {
    expect(resolveInheritedNewSessionDraftOptions({
      currentSessionId: 'ses_home',
      currentSessionDirectory: homeDirectory,
      homeDirectory,
      openedProjectPaths: [homeDirectory],
      activeProjectId: 'home-project',
      activeProjectPath: homeDirectory,
    })).toEqual({ directoryOverride: homeDirectory });
  });

  test('home that is not an opened project stays projectless even without homeDirectory', () => {
    expect(resolveInheritedNewSessionDraftOptions({
      currentSessionId: 'ses_home',
      currentSessionDirectory: homeDirectory,
      homeDirectory: null,
      openedProjectPaths: [],
      activeProjectId: null,
      activeProjectPath: null,
    })).toBe(undefined);
  });
});

const miniChatArgsFromInput = (input: Parameters<typeof resolveInheritedNewSessionDraftOptions>[0]) => (
  mapInheritedNewSessionDraftToMiniChatArgs(resolveInheritedNewSessionDraftOptions(input))
);

describe('mapOpenNewSessionDraftToMiniChatArgs', () => {
  test('projectless New Session draft ignores leftover activeProject inherit', () => {
    expect(mapOpenNewSessionDraftToMiniChatArgs({
      open: true,
      target: 'chat',
      selectedProjectId: null,
      directoryOverride: null,
    })).toEqual({ directory: '', projectId: null });
  });

  test('project New Session draft maps that project path and id', () => {
    expect(mapOpenNewSessionDraftToMiniChatArgs({
      open: true,
      target: 'project',
      selectedProjectId: 'project-1',
      directoryOverride: projectPath,
    })).toEqual({ directory: projectPath, projectId: 'project-1' });
  });

  test('closed draft returns null so inherit can run', () => {
    expect(mapOpenNewSessionDraftToMiniChatArgs({
      open: false,
      target: 'chat',
      selectedProjectId: null,
    })).toBe(null);
  });
});

describe('projectless draft + leftover activeProject (Mini Chat #555)', () => {
  test('open projectless draft wins over leftover active project inherit', () => {
    const fromDraft = mapOpenNewSessionDraftToMiniChatArgs({
      open: true,
      target: 'chat',
      selectedProjectId: null,
      directoryOverride: null,
    });
    // Inherit alone would still see leftover activeProject when there is no session.
    const fromInherit = mapInheritedNewSessionDraftToMiniChatArgs(
      resolveInheritedNewSessionDraftOptions({
        currentSessionId: null,
        currentSessionDirectory: null,
        homeDirectory,
        openedProjectPaths,
        activeProjectId: 'scan-proj',
        activeProjectPath: projectPath,
      }),
    );
    expect(fromInherit).toEqual({ directory: projectPath, projectId: 'scan-proj' });
    expect(fromDraft).toEqual({ directory: '', projectId: null });
    // readMiniChatDraftWindowArgs prefers the draft when open.
    expect(fromDraft ?? fromInherit).toEqual({ directory: '', projectId: null });
  });
});

describe('readMiniChatDraftWindowArgs mapping', () => {
  test('project session → that directory, no leftover project id', () => {
    expect(miniChatArgsFromInput({
      currentSessionId: 'ses_project',
      currentSessionDirectory: projectPath,
      homeDirectory,
      openedProjectPaths,
      activeProjectId: 'other-project',
      activeProjectPath: '/Users/tester/other',
    })).toEqual({ directory: projectPath, projectId: null });
  });

  test('leftover active project + chats session → projectless mini chat args', () => {
    expect(miniChatArgsFromInput({
      currentSessionId: 'ses_chat',
      currentSessionDirectory: chatDirectory,
      homeDirectory,
      openedProjectPaths,
      activeProjectId: 'sess-fx',
      activeProjectPath: projectPath,
    })).toEqual({
      directory: '',
      projectId: null,
    });
  });

  test('no project → empty chats draft args', () => {
    expect(miniChatArgsFromInput({
      currentSessionId: 'ses_chat',
      currentSessionDirectory: chatDirectory,
      homeDirectory,
      openedProjectPaths,
      activeProjectId: null,
      activeProjectPath: null,
    })).toEqual({ directory: '', projectId: null });
  });
});

describe('mini-chat draft callers', () => {
  const files = [
    '../hooks/useKeyboardShortcuts.ts',
    '../hooks/useMiniChatKeyboardShortcuts.ts',
    '../App.tsx',
    '../components/layout/Header.tsx',
    '../components/ui/CommandPalette.tsx',
  ];

  test('open sites use readMiniChatDraftWindowArgs', () => {
    for (const relative of files) {
      const source = readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
      expect(source).toMatch(
        /desktop_open_draft_mini_chat_window[\s\S]{0,120}readMiniChatDraftWindowArgs\(\)/,
      );
    }
  });

  test('Mini Chat bootstrap uses inherit args or a bare chats draft', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../apps/ElectronMiniChatApp.tsx', import.meta.url)),
      'utf8',
    );
    expect(source).toContain('if (config.projectId || config.directory)');
    expect(source).toMatch(/openNewSessionDraft\(\);/);
  });
});

describe('new-session callers', () => {
  test('chats-row caller still bare', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../components/session/SessionSidebar.tsx', import.meta.url)),
      'utf8',
    );

    expect(source).toContain('onNewChat={handleOpenNewChatFromChatsRow}');
    expect(source).toContain('onNewSession={handleOpenNewSessionDraftFromHeader}');
    expect(source).toMatch(
      /const handleOpenNewChatFromChatsRow = React\.useCallback\(\(\) => \{[\s\S]*?openNewSessionDraft\(\);/,
    );
    expect(source).toContain('openNewSessionDraft(readInheritedNewSessionDraftOptions())');
    expect(source).not.toMatch(
      /onNewChat=\{handleOpenNewSessionDraftFromHeader\}/,
    );
  });

  test('mobile sessions + new chat is still a projectless chats draft', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../apps/MobileSessionsSheet.tsx', import.meta.url)),
      'utf8',
    );

    expect(source).toMatch(
      /const handleStartNewChat = \(\) => \{[\s\S]*?openNewSessionDraft\(\);/,
    );
    expect(source).not.toContain('readInheritedNewSessionDraftOptions');
  });
});
