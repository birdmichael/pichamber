import { describe, expect, test } from 'bun:test';

import {
  shouldShowAgentControlToolSettings,
  shouldShowPichamberToolsSettings,
} from './pichamberToolsVisibility';

describe('Pichamber Tools settings visibility', () => {
  test('hides leftover tools on the Pi kernel and in VS Code', () => {
    expect(shouldShowPichamberToolsSettings({ isVSCode: false, isPiKernel: true })).toBe(false);
    expect(shouldShowPichamberToolsSettings({ isVSCode: true, isPiKernel: true })).toBe(false);
    expect(shouldShowPichamberToolsSettings({ isVSCode: false, isPiKernel: false })).toBe(true);
    expect(shouldShowPichamberToolsSettings({ isVSCode: true, isPiKernel: false })).toBe(false);
  });

  test('shows the agent-control row only on leftover OpenCode Desktop', () => {
    expect(shouldShowAgentControlToolSettings({ isVSCode: false, isPiKernel: true })).toBe(false);
    expect(shouldShowAgentControlToolSettings({ isVSCode: false, isPiKernel: false })).toBe(true);
    expect(shouldShowAgentControlToolSettings({})).toBe(true);
    expect(shouldShowAgentControlToolSettings({ isVSCode: true })).toBe(false);
  });
});
