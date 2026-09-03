import { describe, expect, test } from 'bun:test';
import { CHAT_DRAFT_PROJECT_ID } from '@/lib/chatDirectories';
import {
  buildWindowTitle,
  resolveWindowTitleProjectLabel,
} from './useWindowTitle';

const FIXTURE = {
  id: 'fixture',
  path: '/tmp/pichamber-git-fixture',
  label: 'pichamber-git-fixture',
};
const OTHER = {
  id: 'other',
  path: '/tmp/other-project',
  label: 'other-project',
};
const HOME = '/Users/tester';
const CHAT_DIR = `${HOME}/.config/openchamber/chats/2026-08-25/session-a`;

describe('buildWindowTitle', () => {
  test('is just the product name when there is no workspace', () => {
    expect(buildWindowTitle(null, null)).toBe('Pichamber');
  });

  test('puts the visible project before the product name', () => {
    expect(buildWindowTitle('pichamber-git-fixture', null)).toBe('pichamber-git-fixture | Pichamber');
  });

  test('uses the new-session label when the draft is projectless', () => {
    expect(buildWindowTitle(null, null, 'New session')).toBe('New session | Pichamber');
  });

  test('keeps the project and drops the draft label once a project is chosen', () => {
    expect(buildWindowTitle('other-project', null, 'New session')).toBe('other-project | Pichamber');
  });

  test('inserts a remote instance label', () => {
    expect(buildWindowTitle('pichamber-git-fixture', 'Instance')).toBe(
      'pichamber-git-fixture | Instance | Pichamber',
    );
    expect(buildWindowTitle(null, 'Instance', 'New session')).toBe('New session | Instance | Pichamber');
  });
});

describe('resolveWindowTitleProjectLabel', () => {
  test('does not leak leftover opened projects into a projectless new-session draft', () => {
    expect(resolveWindowTitleProjectLabel({
      draft: {
        open: true,
        target: 'chat',
        selectedProjectId: null,
        directoryOverride: null,
      },
      projects: [FIXTURE, OTHER],
    })).toBeNull();
  });

  test('treats the chats draft id as projectless', () => {
    expect(resolveWindowTitleProjectLabel({
      draft: {
        open: true,
        target: 'chat',
        selectedProjectId: CHAT_DRAFT_PROJECT_ID,
        preparedChatDirectory: CHAT_DIR,
      },
      projects: [FIXTURE],
      homeDirectory: HOME,
    })).toBeNull();
  });

  test('uses the project chosen on that window\'s draft', () => {
    expect(resolveWindowTitleProjectLabel({
      draft: {
        open: true,
        target: 'project',
        selectedProjectId: OTHER.id,
        directoryOverride: OTHER.path,
      },
      projects: [FIXTURE, OTHER],
    })).toBe('other-project');
  });

  test('maps a project draft directory when no selectedProjectId is set', () => {
    expect(resolveWindowTitleProjectLabel({
      draft: {
        open: true,
        target: 'project',
        directoryOverride: FIXTURE.path,
      },
      projects: [FIXTURE, OTHER],
    })).toBe('pichamber-git-fixture');
  });

  test('existing session follows the session directory, not another opened project', () => {
    expect(resolveWindowTitleProjectLabel({
      currentSessionId: 'ses_1',
      sessionDirectory: FIXTURE.path,
      draft: { open: false, target: 'chat' },
      projects: [FIXTURE, OTHER],
    })).toBe('pichamber-git-fixture');
  });

  test('worktree sessions use the parent project directory', () => {
    expect(resolveWindowTitleProjectLabel({
      currentSessionId: 'ses_wt',
      sessionDirectory: '/tmp/pichamber-git-fixture-wt',
      worktreeDirectory: '/tmp/pichamber-git-fixture-wt',
      worktreeProjectDirectory: FIXTURE.path,
      projects: [FIXTURE],
    })).toBe('pichamber-git-fixture');
  });

  test('managed chat sessions have no project label', () => {
    expect(resolveWindowTitleProjectLabel({
      currentSessionId: 'ses_chat',
      sessionDirectory: CHAT_DIR,
      projects: [FIXTURE],
      homeDirectory: HOME,
    })).toBeNull();
  });

  test('falls back to the last path segment when the directory is not an opened project', () => {
    expect(resolveWindowTitleProjectLabel({
      currentSessionId: 'ses_1',
      sessionDirectory: '/tmp/unopened-workspace',
      projects: [FIXTURE],
    })).toBe('unopened-workspace');
  });

  test('no session and no draft does not invent a leftover project', () => {
    expect(resolveWindowTitleProjectLabel({
      projects: [FIXTURE],
    })).toBeNull();
  });
});
