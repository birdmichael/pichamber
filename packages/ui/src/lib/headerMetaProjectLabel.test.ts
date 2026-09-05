import { describe, expect, test } from 'bun:test';
import { CHAT_DRAFT_PROJECT_ID } from '@/lib/chatDirectories';
import { resolveHeaderMetaProjectLabel } from './headerMetaProjectLabel';
import { isProjectlessNewSessionDraft } from './newSessionInherit';

describe('isProjectlessNewSessionDraft', () => {
  test('treats chat target as projectless', () => {
    expect(isProjectlessNewSessionDraft({
      open: true,
      target: 'chat',
      selectedProjectId: null,
    })).toBe(true);
  });

  test('treats CHAT_DRAFT id as projectless', () => {
    expect(isProjectlessNewSessionDraft({
      open: true,
      target: 'project',
      selectedProjectId: CHAT_DRAFT_PROJECT_ID,
    })).toBe(true);
  });

  test('treats missing selectedProjectId as projectless', () => {
    expect(isProjectlessNewSessionDraft({
      open: true,
      target: 'project',
      selectedProjectId: null,
    })).toBe(true);
  });

  test('keeps a real project draft', () => {
    expect(isProjectlessNewSessionDraft({
      open: true,
      target: 'project',
      selectedProjectId: 'proj-1',
    })).toBe(false);
  });

  test('closed draft is not projectless-open', () => {
    expect(isProjectlessNewSessionDraft({
      open: false,
      target: 'chat',
    })).toBe(false);
  });
});

describe('resolveHeaderMetaProjectLabel', () => {
  test('hides leftover activeProject for a projectless new-session draft', () => {
    expect(resolveHeaderMetaProjectLabel({
      draft: { open: true, target: 'chat', selectedProjectId: null },
      activeProjectLabel: 'scan-proj',
      draftProjectLabel: null,
    })).toBeNull();
  });

  test('hides leftover activeProject when draft uses CHAT_DRAFT id', () => {
    expect(resolveHeaderMetaProjectLabel({
      draft: { open: true, target: 'chat', selectedProjectId: CHAT_DRAFT_PROJECT_ID },
      activeProjectLabel: 'scan-proj',
    })).toBeNull();
  });

  test('uses the draft project label for a project New Session', () => {
    expect(resolveHeaderMetaProjectLabel({
      draft: { open: true, target: 'project', selectedProjectId: 'other' },
      activeProjectLabel: 'scan-proj',
      draftProjectLabel: 'other-project',
    })).toBe('other-project');
  });

  test('falls back to activeProject when no draft is open', () => {
    expect(resolveHeaderMetaProjectLabel({
      draft: { open: false, target: 'chat' },
      activeProjectLabel: 'scan-proj',
    })).toBe('scan-proj');
  });
});
