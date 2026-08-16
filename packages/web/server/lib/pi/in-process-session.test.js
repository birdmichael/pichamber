import { describe, expect, it, vi } from 'vitest';

import { dispatchPiSessionRequest, resolvePiHost } from './in-process-session.js';

describe('in-process Pi session client', () => {
  it('returns the host when getPiHost provides one', () => {
    const host = { getSession() {} };
    expect(resolvePiHost(() => host, () => false)).toBe(host);
  });

  it('refuses HTTP fallback when the Pi kernel is enabled without a host', () => {
    expect(() => resolvePiHost(() => null, () => true)).toThrow(/refusing self-fetch/);
  });

  it('returns null when OpenCode is the kernel', () => {
    expect(resolvePiHost(() => null, () => false)).toBeNull();
  });

  it('reads session, messages, status, and children without fetch', async () => {
    const host = {
      getSession: vi.fn(() => ({ info: { id: 'ses_1', title: 'Live' } })),
      getMessages: vi.fn(() => [
        { info: { id: 'm1' } },
        { info: { id: 'm2' } },
        { info: { id: 'm3' } },
      ]),
      getStatus: vi.fn(() => ({ ses_1: { type: 'idle' } })),
      listSessionChildren: vi.fn(async () => [
        { id: 'ses_child', parentID: 'ses_1' },
      ]),
      updateSession: vi.fn(() => ({ info: { id: 'ses_1', metadata: { ok: true } } })),
      promptAsync: vi.fn(async () => ({ info: { id: 'm4' } })),
    };

    expect(await dispatchPiSessionRequest(host, '/session/ses_1')).toEqual({ id: 'ses_1', title: 'Live' });
    expect(await dispatchPiSessionRequest(host, '/session/ses_1/message', { query: { limit: '2' } }))
      .toEqual([{ info: { id: 'm2' } }, { info: { id: 'm3' } }]);
    expect(await dispatchPiSessionRequest(host, '/session/status', { directory: '/tmp' }))
      .toEqual({ ses_1: { type: 'idle' } });
    expect(await dispatchPiSessionRequest(host, '/session/ses_1/children'))
      .toEqual([{ id: 'ses_child', parentID: 'ses_1' }]);
    expect(await dispatchPiSessionRequest(host, '/session/ses_1', { method: 'PATCH', body: { title: 'x' } }))
      .toEqual({ id: 'ses_1', metadata: { ok: true } });
    expect(await dispatchPiSessionRequest(host, '/session/ses_1/prompt_async', { method: 'POST', body: { text: 'hi' } }))
      .toEqual({ info: { id: 'm4' } });
    expect(host.getSession).toHaveBeenCalledWith('ses_1');
    expect(host.promptAsync).toHaveBeenCalledWith('ses_1', { text: 'hi' });
  });
});
