import { describe, expect, it } from 'vitest';

import { buildHealthSnapshot } from './health-snapshot.js';

describe('buildHealthSnapshot', () => {
  it('does not claim OpenCode is running on the Pi kernel', () => {
    const snapshot = buildHealthSnapshot({
      kernel: 'pi',
      piMock: false,
      piReady: true,
      openCodePort: 4096,
      isOpenCodeReady: true,
      isRestartingOpenCode: false,
      extras: {
        lastOpenCodeError: null,
        apiOnly: false,
      },
    });

    expect(snapshot).toMatchObject({
      kernel: 'pi',
      piMock: false,
      openCodePort: null,
      openCodeRunning: false,
      isOpenCodeReady: false,
      kernelReady: true,
      piRunning: true,
      lastOpenCodeError: null,
      apiOnly: false,
    });
  });

  it('reports Pi as not ready when the in-process kernel is not ready', () => {
    const snapshot = buildHealthSnapshot({
      kernel: 'pi',
      piReady: false,
      isOpenCodeReady: true,
    });

    expect(snapshot).toMatchObject({
      kernel: 'pi',
      openCodePort: null,
      openCodeRunning: false,
      isOpenCodeReady: false,
      kernelReady: false,
      piRunning: false,
    });
  });

  it('keeps OpenCode readiness on the leftover OpenCode kernel', () => {
    const snapshot = buildHealthSnapshot({
      kernel: 'opencode',
      piMock: false,
      piReady: false,
      openCodePort: 4096,
      isOpenCodeReady: true,
      isRestartingOpenCode: false,
    });

    expect(snapshot).toMatchObject({
      kernel: 'opencode',
      piMock: false,
      openCodePort: 4096,
      openCodeRunning: true,
      isOpenCodeReady: true,
      kernelReady: true,
      piRunning: false,
    });
  });

  it('keeps Pi OpenCode flags honest even when extras try to overwrite them', () => {
    const snapshot = buildHealthSnapshot({
      kernel: 'pi',
      piReady: true,
      extras: {
        openCodeRunning: true,
        isOpenCodeReady: true,
        openCodePort: 4096,
      },
    });

    expect(snapshot.openCodeRunning).toBe(false);
    expect(snapshot.isOpenCodeReady).toBe(false);
    expect(snapshot.openCodePort).toBeNull();
    expect(snapshot.kernelReady).toBe(true);
    expect(snapshot.piRunning).toBe(true);
  });

  it('treats a restarting OpenCode process as not running', () => {
    const snapshot = buildHealthSnapshot({
      kernel: 'opencode',
      openCodePort: 4096,
      isOpenCodeReady: true,
      isRestartingOpenCode: true,
    });

    expect(snapshot).toMatchObject({
      kernel: 'opencode',
      openCodeRunning: false,
      isOpenCodeReady: true,
      kernelReady: false,
      piRunning: false,
    });
  });
});
