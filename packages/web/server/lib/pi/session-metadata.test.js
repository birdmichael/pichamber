import { describe, expect, it } from 'vitest';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  PICHAMBER_METADATA_CUSTOM_TYPE,
  persistSessionMetadata,
  readPersistedArchivedTimestamp,
  readPersistedParentID,
  readPersistedSessionMetadata,
  LIST_METADATA_TAIL_CHUNK_SIZE,
  readPersistedSessionMetadataFromFile,
  readPersistedSessionMetadataFromFileTail,
  sessionTimeWithArchived,
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

  it('reads clone/fork parentID from pichamber.metadata and ignores empty values', () => {
    expect(readPersistedParentID({ parentID: 'source-session' })).toBe('source-session');
    expect(readPersistedParentID({ parentID: '  child-parent  ' })).toBe('child-parent');
    expect(readPersistedParentID({ parentID: '' })).toBeUndefined();
    expect(readPersistedParentID({ parentID: '   ' })).toBeUndefined();
    expect(readPersistedParentID({})).toBeUndefined();
    expect(readPersistedParentID(undefined)).toBeUndefined();
    expect(readPersistedParentID({ parentID: 12 })).toBeUndefined();
  });

  it('reads archived: ms | 0 from pichamber.metadata and ignores invalid values', () => {
    expect(readPersistedArchivedTimestamp({ archived: 1_700_000_000_000 })).toBe(1_700_000_000_000);
    expect(readPersistedArchivedTimestamp({ archived: 0 })).toBe(0);
    expect(readPersistedArchivedTimestamp({ archived: '0' })).toBe(0);
    expect(readPersistedArchivedTimestamp({ archived: '1700000000000' })).toBe(1_700_000_000_000);
    expect(readPersistedArchivedTimestamp(undefined)).toBeUndefined();
    expect(readPersistedArchivedTimestamp({ archived: -1 })).toBeUndefined();
    expect(readPersistedArchivedTimestamp({ archived: 'nope' })).toBeUndefined();
    expect(sessionTimeWithArchived({ created: 1, updated: 2 }, { archived: 9 })).toEqual({
      created: 1,
      updated: 2,
      archived: 9,
    });
    expect(sessionTimeWithArchived({ created: 1, updated: 2 }, { archived: 0 })).toEqual({
      created: 1,
      updated: 2,
      archived: 0,
    });
    expect(sessionTimeWithArchived({ created: 1, updated: 2 }, {})).toEqual({
      created: 1,
      updated: 2,
    });
  });

  it('reads the latest pichamber.metadata from a jsonl file without a second store', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-metadata-file-'));
    const file = path.join(dir, 'session.jsonl');
    fs.writeFileSync(file, [
      JSON.stringify({ type: 'session', id: 'ses_1' }),
      JSON.stringify({ type: 'custom', customType: PICHAMBER_METADATA_CUSTOM_TYPE, data: { archived: 1 } }),
      '{not-json',
      JSON.stringify({ type: 'custom', customType: PICHAMBER_METADATA_CUSTOM_TYPE, data: { archived: 0, openchamber: { goal: { id: 'g' } } } }),
      '',
    ].join('\n'));
    expect(readPersistedSessionMetadataFromFile(file)).toEqual({
      archived: 0,
      openchamber: { goal: { id: 'g' } },
    });
    expect(readPersistedSessionMetadataFromFile(path.join(dir, 'missing.jsonl'))).toBeUndefined();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('tail-scans the last pichamber.metadata without full-reading a large jsonl', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-metadata-tail-'));
    const file = path.join(dir, 'archived.jsonl');
    const pad = `${'x'.repeat(256 * 1024)}\n`;
    fs.writeFileSync(file, [
      JSON.stringify({ type: 'session', id: 'ses_archived' }),
      JSON.stringify({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: pad }] } }),
      JSON.stringify({ type: 'custom', customType: PICHAMBER_METADATA_CUSTOM_TYPE, data: { archived: 1, stale: true } }),
      JSON.stringify({ type: 'custom', customType: PICHAMBER_METADATA_CUSTOM_TYPE, data: { archived: 9, parentID: 'root' } }),
      '',
    ].join('\n'));
    const size = fs.statSync(file).size;
    let bytesRead = 0;
    const metadata = readPersistedSessionMetadataFromFileTail(file, {
      io: {
        readSync(fd, buffer, offset, length, position) {
          const n = fs.readSync(fd, buffer, offset, length, position);
          bytesRead += n;
          return n;
        },
      },
    });
    expect(metadata).toEqual({ archived: 9, parentID: 'root' });
    expect(size).toBeGreaterThan(200_000);
    expect(bytesRead).toBeLessThan(LIST_METADATA_TAIL_CHUNK_SIZE * 2);
    expect(bytesRead).toBeLessThan(size / 8);
    expect(readPersistedSessionMetadataFromFileTail(path.join(dir, 'missing.jsonl'))).toBeUndefined();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
