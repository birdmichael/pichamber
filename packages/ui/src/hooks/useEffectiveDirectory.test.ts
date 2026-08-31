import { describe, expect, test } from 'bun:test';
import { CHAT_DRAFT_PROJECT_ID, resolveNewSessionComposerDirectory } from '@/lib/chatDirectories';
import {
  resolveContextPanelDirectoryKey,
  resolveEffectiveDirectory,
} from './useEffectiveDirectory';

const PROJECT = '/Users/tester/project-a';
const HOME = '/Users/tester';
const CHAT_DIR = `${HOME}/.config/openchamber/chats/2026-08-25/session-a`;

describe('resolveEffectiveDirectory', () => {
  test('prefers the active session directory over the last project fallback', () => {
    expect(resolveEffectiveDirectory({
      currentSessionId: 'ses_1',
      sessionDirectory: CHAT_DIR,
      fallbackDirectory: PROJECT,
    })).toBe(CHAT_DIR);
  });

  test('uses a project draft directory instead of the last project fallback', () => {
    expect(resolveEffectiveDirectory({
      draft: { open: true, target: 'project', directoryOverride: PROJECT },
      fallbackDirectory: '/Users/tester/other',
    })).toBe(PROJECT);
  });

  test('does not inherit the last project directory for a projectless chats draft', () => {
    expect(resolveEffectiveDirectory({
      draft: { open: true, target: 'chat', directoryOverride: null },
      fallbackDirectory: PROJECT,
    })).toBe(undefined);
  });

  test('uses a prepared chat directory once send has created one', () => {
    expect(resolveEffectiveDirectory({
      draft: { open: true, target: 'chat', preparedChatDirectory: CHAT_DIR },
      fallbackDirectory: PROJECT,
    })).toBe(CHAT_DIR);
  });
});

describe('resolveContextPanelDirectoryKey', () => {
  test('keeps a real session directory', () => {
    expect(resolveContextPanelDirectoryKey(PROJECT, { open: true, target: 'chat' })).toBe(PROJECT);
  });

  test('uses the chats bucket for a projectless chats draft', () => {
    expect(resolveContextPanelDirectoryKey(undefined, { open: true, target: 'chat' })).toBe(CHAT_DRAFT_PROJECT_ID);
    expect(resolveContextPanelDirectoryKey('', { open: true, target: 'chat' })).toBe(CHAT_DRAFT_PROJECT_ID);
  });

  test('does not invent a chats key for a project draft or a closed draft', () => {
    expect(resolveContextPanelDirectoryKey(undefined, { open: true, target: 'project' })).toBe('');
    expect(resolveContextPanelDirectoryKey(undefined, { open: false, target: 'chat' })).toBe('');
    expect(resolveContextPanelDirectoryKey(undefined, null)).toBe('');
  });
});

describe('resolveNewSessionComposerDirectory', () => {
  test('projectless chat drafts use the chats bucket, not ~', () => {
    expect(resolveNewSessionComposerDirectory({
      open: true,
      target: 'chat',
      directoryOverride: null,
    })).toBe(CHAT_DRAFT_PROJECT_ID);
  });

  test('project drafts keep their directory override', () => {
    expect(resolveNewSessionComposerDirectory({
      open: true,
      target: 'project',
      directoryOverride: PROJECT,
    })).toBe(PROJECT);
  });
});

