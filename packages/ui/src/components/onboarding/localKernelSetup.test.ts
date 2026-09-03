import { describe, expect, test } from 'bun:test';

import {
  OPENCODE_INSTALL_COMMAND,
  PI_INSTALL_COMMAND,
  kernelBinaryPlaceholder,
  localKernelSetup,
  readLocalKernelHealth,
  resolveLocalKernelName,
} from './localKernelSetup';

describe('localKernelSetup', () => {
  test('Pi kernel copy is not the OpenCode curl install command', () => {
    const setup = localKernelSetup('pi');
    expect(setup.kernel).toBe('pi');
    expect(setup.installCommand).toBe(PI_INSTALL_COMMAND);
    expect(setup.installCommand.includes('opencode.ai')).toBe(false);
    expect(setup.installCommand.includes('@earendil-works/pi-coding-agent')).toBe(true);
    expect(setup.docsUrl.includes('opencode.ai')).toBe(false);
    expect(setup.binaryName).toBe('pi');
  });

  test('unknown and missing kernel default to Pi, not OpenCode', () => {
    expect(resolveLocalKernelName(undefined)).toBe('pi');
    expect(resolveLocalKernelName(null)).toBe('pi');
    expect(localKernelSetup(undefined).installCommand).toBe(PI_INSTALL_COMMAND);
    expect(localKernelSetup({}).installCommand).toBe(PI_INSTALL_COMMAND);
  });

  test('leftover OpenCode kernel keeps the OpenCode curl install command', () => {
    const setup = localKernelSetup('opencode');
    expect(setup.kernel).toBe('opencode');
    expect(setup.installCommand).toBe(OPENCODE_INSTALL_COMMAND);
    expect(setup.installCommand).toBe('curl -fsSL https://opencode.ai/install | bash');
    expect(setup.docsUrl).toBe('https://opencode.ai/docs');
    expect(setup.binaryName).toBe('opencode');
  });

  test('placeholders follow the active kernel binary name', () => {
    expect(kernelBinaryPlaceholder('pi', 'macos')).toBe('/Users/you/.bun/bin/pi');
    expect(kernelBinaryPlaceholder('pi', 'linux')).toBe('/home/you/.bun/bin/pi');
    expect(kernelBinaryPlaceholder('pi', 'windows')).toBe('C:\\Users\\you\\AppData\\Roaming\\npm\\pi.cmd');
    expect(kernelBinaryPlaceholder('opencode', 'macos')).toBe('/Users/you/.bun/bin/opencode');
    expect(kernelBinaryPlaceholder('opencode', 'windows')).toBe('C:\\Users\\you\\AppData\\Roaming\\npm\\opencode.cmd');
  });

  test('reads Pi detection from health without treating OpenCode flags as ready', () => {
    const health = readLocalKernelHealth({
      kernel: 'pi',
      kernelReady: false,
      piRunning: false,
      openCodeRunning: true,
      piBinaryResolved: '/opt/homebrew/bin/pi',
      piBinarySource: 'fallback',
    });
    expect(health).toEqual({
      kernel: 'pi',
      ready: false,
      piBinaryResolved: '/opt/homebrew/bin/pi',
      piBinarySource: 'fallback',
    });
  });

  test('does not surface Pi detection on the OpenCode kernel', () => {
    const health = readLocalKernelHealth({
      kernel: 'opencode',
      openCodeRunning: true,
      isOpenCodeReady: true,
      piBinaryResolved: '/opt/homebrew/bin/pi',
    });
    expect(health.kernel).toBe('opencode');
    expect(health.ready).toBe(true);
    expect(health.piBinaryResolved).toBeNull();
  });
});
