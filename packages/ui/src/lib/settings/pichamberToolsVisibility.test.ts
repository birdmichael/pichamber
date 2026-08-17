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

  test('shows the agent-control row on Pi Desktop and leftover OpenCode Desktop', () => {
    expect(shouldShowAgentControlToolSettings({ isVSCode: false })).toBe(true);
    expect(shouldShowAgentControlToolSettings({})).toBe(true);
    expect(shouldShowAgentControlToolSettings({ isVSCode: true })).toBe(false);
  });
});
