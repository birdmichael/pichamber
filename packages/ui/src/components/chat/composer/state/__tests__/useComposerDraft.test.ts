import { beforeEach, describe, expect, test } from 'bun:test';

import {
  createChatDraftIdentity,
  readChatDraft,
} from '@/lib/chatDraftPersistence';
import { getDeferredSafeStorage } from '@/stores/utils/safeStorage';
import { applyComposerIdentitySwitch } from '../useComposerDraft';

const storage = getDeferredSafeStorage();

describe('applyComposerIdentitySwitch', () => {
  beforeEach(() => {
    storage.removeItem('openchamber.chatDrafts.v2');
  });

  test('A → B → A restores A and never shows A on B', () => {
    const sessionA = createChatDraftIdentity('runtime-a', '/repo', 'session-a')!;
    const sessionB = createChatDraftIdentity('runtime-a', '/repo', 'session-b')!;

    const afterLeaveA = applyComposerIdentitySwitch({
      previous: sessionA,
      next: sessionB,
      currentText: 'ping',
      persistEnabled: true,
    });

    expect(afterLeaveA.changed).toBe(true);
    expect(afterLeaveA.text).toBe('');
    expect(readChatDraft(sessionA).text).toBe('ping');
    expect(readChatDraft(sessionB).text).toBe('');

    const afterReturnA = applyComposerIdentitySwitch({
      previous: sessionB,
      next: sessionA,
      currentText: afterLeaveA.text,
      persistEnabled: true,
    });

    expect(afterReturnA.text).toBe('ping');
    expect(readChatDraft(sessionB).text).toBe('');
    expect(readChatDraft(sessionA).text).toBe('ping');
  });

  test('a new-session draft does not leak onto an existing chat', () => {
    const newSession = createChatDraftIdentity('runtime-a', '/repo', null)!;
    const existing = createChatDraftIdentity('runtime-a', '/repo', 'session-a')!;

    const afterOpenExisting = applyComposerIdentitySwitch({
      previous: newSession,
      next: existing,
      currentText: 'new-session ping',
      persistEnabled: true,
    });

    expect(afterOpenExisting.text).toBe('');
    expect(readChatDraft(newSession).text).toBe('new-session ping');
    expect(readChatDraft(existing).text).toBe('');
  });

  test('an existing draft does not leak onto New session', () => {
    const existing = createChatDraftIdentity('runtime-a', '/repo', 'session-a')!;
    const newSession = createChatDraftIdentity('runtime-a', '/repo', null)!;

    const afterOpenDraft = applyComposerIdentitySwitch({
      previous: existing,
      next: newSession,
      currentText: 'ping',
      persistEnabled: true,
    });

    expect(afterOpenDraft.text).toBe('');
    expect(readChatDraft(existing).text).toBe('ping');
    expect(readChatDraft(newSession).text).toBe('');
  });

  test('an existing projectless draft does not leak onto New session', () => {
    const existing = createChatDraftIdentity('runtime-a', '/home/tester', 'session-a')!;
    const newSession = createChatDraftIdentity('runtime-a', 'openchamber:chats', null)!;

    const afterOpenDraft = applyComposerIdentitySwitch({
      previous: existing,
      next: newSession,
      currentText: 'projectless-draft',
      persistEnabled: true,
    });

    expect(afterOpenDraft.text).toBe('');
    expect(readChatDraft(existing).text).toBe('projectless-draft');
    expect(readChatDraft(newSession).text).toBe('');
  });

  test('B keeps its own draft when A is restored', () => {
    const sessionA = createChatDraftIdentity('runtime-a', '/repo', 'session-a')!;
    const sessionB = createChatDraftIdentity('runtime-a', '/repo', 'session-b')!;

    applyComposerIdentitySwitch({
      previous: sessionA,
      next: sessionB,
      currentText: 'ping',
      persistEnabled: true,
    });
    const afterLeaveB = applyComposerIdentitySwitch({
      previous: sessionB,
      next: sessionA,
      currentText: 'bravo',
      persistEnabled: true,
    });

    expect(afterLeaveB.text).toBe('ping');
    expect(readChatDraft(sessionB).text).toBe('bravo');
  });
});
