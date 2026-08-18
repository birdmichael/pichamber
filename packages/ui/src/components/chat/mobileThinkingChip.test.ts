import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';

import { usePiThinkingChipStore } from './piThinkingChipStore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const chatInputSource = readFileSync(join(__dirname, 'ChatInput.tsx'), 'utf-8');
const buttonSource = readFileSync(join(__dirname, 'MobileThinkingButton.tsx'), 'utf-8');
const modelControlsSource = readFileSync(join(__dirname, 'ModelControls.tsx'), 'utf-8');

describe('mobile thinking chip', () => {
  test('the expanded mobile composer opens the existing thinking sheet', () => {
    expect(chatInputSource).toContain('<MemoMobileThinkingButton');
    expect(chatInputSource).toContain("handleOpenMobilePanel('variant')");
    expect(modelControlsSource).toContain('renderMobilePiThinkingPanel');
    expect(modelControlsSource).toContain("activeMobilePanel === 'variant'");
    expect(modelControlsSource).toContain('usePiThinkingChipStore.getState().setLevel');
  });

  test('the chip is Pi-only and keeps the keyboard-open tap guard', () => {
    expect(buttonSource).toContain('usePiKernel');
    expect(buttonSource).toContain('if (!isPiKernel)');
    expect(buttonSource).toContain('return null');
    expect(buttonSource).toContain('event.preventDefault()');
  });

  test('shares the live thinking level with the hidden ModelControls host', () => {
    usePiThinkingChipStore.getState().setLevel('low');
    expect(usePiThinkingChipStore.getState().level).toBe('low');
    usePiThinkingChipStore.getState().setLevel(undefined);
    expect(usePiThinkingChipStore.getState().level).toBe(undefined);
  });
});
