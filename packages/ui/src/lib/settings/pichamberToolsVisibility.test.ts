import { describe, expect, test } from 'bun:test';

import {
  shouldShowAgentControlToolSettings,
  shouldShowPichamberToolsSettings,
} from './pichamberToolsVisibility';

describe('Pichamber Tools settings visibility', () => {
  test('mounts the tools card on Pi Desktop and leftover OpenCode Desktop', () => {
    expect(shouldShowPichamberToolsSettings({ isVSCode: false })).toBe(true);
    expect(shouldShowPichamberToolsSettings({ isVSCode: true })).toBe(false);
  });

  test('hides the agent-control row on Pi', () => {
    expect(shouldShowAgentControlToolSettings({ isPiKernel: true })).toBe(false);
    expect(shouldShowAgentControlToolSettings({ isPiKernel: false })).toBe(true);
  });
});
