import { describe, expect, test } from 'bun:test';
import type { Message, Part } from '@opencode-ai/sdk/v2';

import { resolveToolDisplayName } from '@/lib/toolHelpers';
import { projectTurnActivity } from '../../lib/turns/projectTurnActivity';
import type { ChatMessageEntry } from '../../lib/turns/types';

const pichamberWebPart = {
  id: 'prt_web',
  type: 'tool',
  tool: 'pichamber_web',
  callID: 'call_web',
  state: {
    status: 'completed',
    input: { action: 'browser.open', url: 'https://example.test' },
    output: JSON.stringify({
      schemaVersion: 1,
      ok: true,
      action: 'browser.open',
      data: { url: 'https://example.test' },
    }),
  },
} as Part;

const cardLabels = (parts: Part[]) => {
  const message: ChatMessageEntry = {
    info: { id: 'msg_1', role: 'assistant' } as Message,
    parts,
  };
  return projectTurnActivity({
    turnId: 'turn_1',
    assistantMessages: [message],
    showTextJustificationActivity: false,
  }).activityParts
    .filter((activity) => activity.kind === 'tool')
    .map((activity) => resolveToolDisplayName(
      typeof (activity.part as { tool?: unknown }).tool === 'string'
        ? (activity.part as { tool: string }).tool
        : '',
    ));
};

describe('Pichamber Web transcript cards', () => {
  test('a pichamber_web start+result pair presents as one Pichamber Web card', () => {
    const labels = cardLabels([pichamberWebPart]);
    expect(labels).toEqual(['Pichamber Web']);
    expect(labels).not.toContain('Tool');
  });
});
