import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';

import { resolveMiniChatHeaderProjectLabel } from './miniChatHeaderLabel';

const homeDirectory = '/Users/tester';
const projectPath = '/Users/tester/sess-fx';
const chatDirectory = '/Users/tester/.config/openchamber/chats/2026-08-25/session-a';
const sessFx = { id: 'sess-fx', path: projectPath, label: 'sess-fx' };

describe('resolveMiniChatHeaderProjectLabel', () => {
  test('uses the path-matched project from the session directory', () => {
    expect(resolveMiniChatHeaderProjectLabel({
      pathMatchedProject: sessFx,
      activeProject: { path: '/Users/tester/other', label: 'other' },
      directoryLabel: 'sess-fx',
      sessionDirectory: projectPath,
      homeDirectory,
      openedProjectPaths: [projectPath],
    })).toBe('sess-fx');
  });

  test('does not fall back to leftover activeProject for a chats draft', () => {
    expect(resolveMiniChatHeaderProjectLabel({
      pathMatchedProject: null,
      activeProject: sessFx,
      directoryLabel: '',
      draftTarget: 'chat',
      sessionDirectory: chatDirectory,
      homeDirectory,
      openedProjectPaths: [projectPath],
    })).toBe('Pichamber');
  });

  test('ignores path-matched leftover project for a projectless chats draft', () => {
    expect(resolveMiniChatHeaderProjectLabel({
      pathMatchedProject: sessFx,
      activeProject: sessFx,
      directoryLabel: 'sess-fx',
      draftTarget: 'chat',
      draftSelectedProjectId: null,
      sessionDirectory: projectPath,
      homeDirectory,
      openedProjectPaths: [projectPath],
    })).toBe('Pichamber');
  });

  test('does not fall back to leftover activeProject for a managed-chat session', () => {
    expect(resolveMiniChatHeaderProjectLabel({
      pathMatchedProject: null,
      activeProject: sessFx,
      directoryLabel: '~/.config/openchamber/chats/session-a',
      sessionDirectory: chatDirectory,
      homeDirectory,
      openedProjectPaths: [projectPath],
    })).toBe('~/.config/openchamber/chats/session-a');
  });

  test('falls back to activeProject for a project draft without a path match', () => {
    expect(resolveMiniChatHeaderProjectLabel({
      pathMatchedProject: null,
      activeProject: sessFx,
      directoryLabel: '',
      draftTarget: 'project',
      draftSelectedProjectId: 'sess-fx',
      sessionDirectory: projectPath,
      homeDirectory,
      openedProjectPaths: [projectPath],
    })).toBe('sess-fx');
  });

  test('project draft with no selectedProjectId stays projectless (no leftover active)', () => {
    expect(resolveMiniChatHeaderProjectLabel({
      pathMatchedProject: null,
      activeProject: sessFx,
      directoryLabel: 'sess-fx',
      draftTarget: 'project',
      draftSelectedProjectId: null,
      sessionDirectory: projectPath,
      homeDirectory,
      openedProjectPaths: [projectPath],
    })).toBe('Pichamber');
  });
});

describe('MiniChatLayout drag and overflow', () => {
  test('title bar is an app-region drag target and the column cannot overflow chrome', () => {
    const source = readFileSync(fileURLToPath(new URL('./MiniChatLayout.tsx', import.meta.url)), 'utf8');
    expect(source).toContain('app-region-drag');
    expect(source).toContain('select-none');
    expect(source).toContain('flex h-full min-h-0 flex-col overflow-hidden');
    expect(source).toContain('<div className="min-w-0 flex-1" />');
    expect(source).toContain('resolveMiniChatHeaderProjectLabel');
  });
});
