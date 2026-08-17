import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decodeDesktopImagePayload } from './save-image-payload.mjs';

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d,
]);
const PNG_BASE64 = PNG_BYTES.toString('base64');
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`;

describe('decodeDesktopImagePayload', () => {
  it('accepts a PNG data URL', () => {
    assert.deepEqual(decodeDesktopImagePayload({ dataUrl: PNG_DATA_URL }), PNG_BYTES);
  });

  it('accepts raw PNG base64', () => {
    assert.deepEqual(decodeDesktopImagePayload({ base64: PNG_BASE64 }), PNG_BYTES);
  });

  it('rejects a missing payload', () => {
    assert.throws(() => decodeDesktopImagePayload({}), /Image payload is required/);
  });

  it('rejects a non-image data URL', () => {
    assert.throws(
      () => decodeDesktopImagePayload({ dataUrl: 'data:text/plain;base64,aGVsbG8=' }),
      /Image payload must be a PNG/,
    );
  });

  it('rejects a JPEG data URL', () => {
    assert.throws(
      () => decodeDesktopImagePayload({ dataUrl: 'data:image/jpeg;base64,/9j/4AAQ' }),
      /Image payload must be a PNG/,
    );
  });

  it('rejects base64 that is not a PNG', () => {
    assert.throws(
      () => decodeDesktopImagePayload({ base64: Buffer.from('not-a-png').toString('base64') }),
      /Image payload must be a PNG/,
    );
  });
});
