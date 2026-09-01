import { describe, expect, test } from 'bun:test';

import { formatKernelResolutionLines } from './openCodeStatus';

describe('formatKernelResolutionLines', () => {
  test('on Pi lists the bundled Node child, not leftover OpenCode PATH', () => {
    const lines = formatKernelResolutionLines({
      kernel: 'pi',
      health: {
        kernel: 'pi',
        opencodeBinaryResolved: '/Users/bm/.opencode/bin/opencode',
        opencodeBinarySource: 'path',
        piNodeRuntime: {
          ok: true,
          command: '/Applications/Pichamber.app/Contents/Resources/node/bin/node',
          source: 'bundled',
          childScript: '/app/node-kernel-child.js',
          pid: 26714,
          hello: {
            sdk: {
              package: '@earendil-works/pi-coding-agent',
              version: '0.84.2',
            },
          },
        },
      },
      opencodeResolution: {
        resolved: '/Users/bm/.opencode/bin/opencode',
        source: 'path',
      },
      isMac: true,
    });

    const text = lines.join('\n');
    expect(text).toContain('Pi kernel resolution:');
    expect(text).toContain('source=bundled');
    expect(text).toContain('@earendil-works/pi-coding-agent 0.84.2');
    expect(text).not.toContain('/.opencode/bin/opencode');
    expect(text).not.toContain('OpenCode resolution:');
  });

  test('on leftover OpenCode kernel keeps the OpenCode resolver dump', () => {
    const lines = formatKernelResolutionLines({
      kernel: 'opencode',
      health: {
        kernel: 'opencode',
        opencodeBinaryResolved: '/Users/bm/.opencode/bin/opencode',
        opencodeBinarySource: 'path',
      },
      opencodeResolution: null,
      isMac: true,
    });

    const text = lines.join('\n');
    expect(text).toContain('OpenCode resolution:');
    expect(text).toContain('/Users/bm/.opencode/bin/opencode');
    expect(text).not.toContain('Pi kernel resolution:');
  });

  test('missing health kernel does not dump leftover OpenCode PATH', () => {
    const lines = formatKernelResolutionLines({
      kernel: '',
      health: null,
      opencodeResolution: {
        resolved: '/Users/bm/.opencode/bin/opencode',
        source: 'path',
      },
      isMac: true,
    });

    const text = lines.join('\n');
    expect(text).toContain('Pi kernel resolution:');
    expect(text).not.toContain('/.opencode/bin/opencode');
  });

  test('prints SDK hello failures even when node resolve ok is true', () => {
    const lines = formatKernelResolutionLines({
      kernel: 'pi',
      health: {
        piNodeRuntime: {
          ok: true,
          command: '/app/node',
          source: 'bundled',
          code: 'PI_SDK_UNAVAILABLE',
          message: 'SDK import failed',
          recovery: 'Install the bundled Node child.',
        },
      },
      opencodeResolution: null,
      isMac: true,
    });

    const text = lines.join('\n');
    expect(text).toContain('PI_SDK_UNAVAILABLE');
    expect(text).toContain('SDK import failed');
    expect(text).toContain('Install the bundled Node child.');
  });
});
