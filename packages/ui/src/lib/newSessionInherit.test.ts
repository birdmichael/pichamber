import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';

import { resolveInheritedNewSessionDraftOptions } from './newSessionInherit';

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

  test('managed-chat current session + active project → project', () => {
    expect(resolveInheritedNewSessionDraftOptions({
      currentSessionId: 'ses_chat',
      currentSessionDirectory: chatDirectory,
      homeDirectory,
      openedProjectPaths,
      activeProjectId: 'project-1',
      activeProjectPath: projectPath,
    })).toEqual({
      selectedProjectId: 'project-1',
      directoryOverride: projectPath,
    });
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
