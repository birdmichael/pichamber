import { describe, expect, it } from 'vitest';

import {
  PICHAMBER_METADATA_CUSTOM_TYPE,
  persistSessionMetadata,
  readPersistedSessionMetadata,
} from './session-metadata.js';

const goalMetadata = {
  openchamber: {
    goal: {
      id: 'goal_1',
      objective: 'Finish the restore',
      status: 'active',
    },
  },
};

describe('Pi session metadata persistence', () => {
  it('reads the latest pichamber.metadata custom entry', () => {
    expect(readPersistedSessionMetadata([
      { type: 'session_info', name: 'Title' },
      { type: 'custom', customType: PICHAMBER_METADATA_CUSTOM_TYPE, data: { stale: true } },
      { type: 'custom', customType: 'other.extension', data: { ignore: true } },
      { type: 'custom', customType: PICHAMBER_METADATA_CUSTOM_TYPE, data: goalMetadata },
    ])).toEqual(goalMetadata);
  });

  it('treats a missing or malformed custom entry as no metadata, not empty success', () => {
    expect(readPersistedSessionMetadata(undefined)).toBeUndefined();
    expect(readPersistedSessionMetadata([])).toBeUndefined();
    expect(readPersistedSessionMetadata([
      { type: 'custom', customType: PICHAMBER_METADATA_CUSTOM_TYPE, data: 'not-an-object' },
    ])).toBeUndefined();
  });

  it('appends metadata through SessionManager.appendCustomEntry', () => {
    const appended = [];
    const ok = persistSessionMetadata({
      appendCustomEntry(customType, data) {
        appended.push({ customType, data });
        return 'entry_1';
      },
    }, goalMetadata);
    expect(ok).toBe(true);
    expect(appended).toEqual([{ customType: PICHAMBER_METADATA_CUSTOM_TYPE, data: goalMetadata }]);
  });

  it('does not pretend a write succeeded when the manager cannot persist', () => {
    expect(persistSessionMetadata({}, goalMetadata)).toBe(false);
    expect(persistSessionMetadata({ appendCustomEntry() {} }, null)).toBe(false);
    expect(persistSessionMetadata({
      appendCustomEntry() {
        throw new Error('disk full');
      },
    }, goalMetadata)).toBe(false);
  });
});
