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
    expect(buttonSource).toContain('if (!isPiKernel || !hasLevels)');
    expect(buttonSource).toContain('return null');
    expect(buttonSource).toContain('event.preventDefault()');
  });

  test('shares the live thinking level with the hidden ModelControls host', () => {
    usePiThinkingChipStore.getState().setLevel('low', true);
    expect(usePiThinkingChipStore.getState().level).toBe('low');
    expect(usePiThinkingChipStore.getState().hasLevels).toBe(true);
    usePiThinkingChipStore.getState().setLevel(undefined, false);
    expect(usePiThinkingChipStore.getState().level).toBe(undefined);
    expect(usePiThinkingChipStore.getState().hasLevels).toBe(false);
  });

  test('pairs the thinking chip to the selected model catalog immediately', () => {
    expect(modelControlsSource).toContain('resolvePairedPiThinking');
    expect(modelControlsSource).toContain('catalogLevels: draftThinkingLevels');
    expect(modelControlsSource).toContain('resolvePiThinkingChipPresentation(pairedThinking.thinking)');
    expect(modelControlsSource).toContain('sessionModelApplyRef');
    expect(modelControlsSource).toContain('pairedThinking.levels.length === 0');
    expect(modelControlsSource).toContain('restoredSessionModelRef');
    expect(modelControlsSource).toContain('composerPickedModelRef');
    expect(modelControlsSource).toContain('fromRestore: true');
    expect(modelControlsSource).toContain('fromComposer: true');
    expect(modelControlsSource).toContain('thinkingPairKeyRef');
    expect(modelControlsSource).toContain('pinGeneration');
    expect(modelControlsSource).toContain('pinKey');
    expect(modelControlsSource).toContain('applyComposerThinking');
    expect(buttonSource).toContain('hasLevels');
  });

  test('session switch waits for GET instead of painting medium', () => {
    expect(modelControlsSource).toContain('#488: wait for GET');
    expect(modelControlsSource).toContain('setPiThinking(undefined)');
  });

  test('composer thinking does not PATCH global Pi defaults', () => {
    const cycleSource = readFileSync(join(__dirname, 'cycleComposerThinking.ts'), 'utf-8');
    expect(cycleSource).not.toContain('/api/pi/defaults');
    expect(cycleSource).toContain('/thinking');
  });
});
