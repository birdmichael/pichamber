import { describe, expect, test } from 'bun:test';
import type { Part } from '@opencode-ai/sdk/v2';

import { collectSavableMessageImages, partsHaveImage } from './messageImages';

describe('messageImages', () => {
  test('hides save-as-image for text-only turns', () => {
    expect(partsHaveImage([
      { type: 'text', text: 'hello' } as Part,
      { type: 'file', mime: 'text/plain', filename: 'notes.txt' } as Part,
    ])).toBe(false);
  });

  test('finds file images and tool attachments', () => {
    expect(partsHaveImage([
      { type: 'text', text: 'see this' } as Part,
      { type: 'file', mime: 'image/png', filename: 'plot.png' } as Part,
    ])).toBe(true);

    expect(partsHaveImage([
      {
        type: 'tool',
        state: {
          attachments: [{ type: 'file', mimeType: 'image/jpeg', filename: 'shot.jpg' }],
        },
      } as unknown as Part,
    ])).toBe(true);
  });

  test('collects data URLs for a direct save', () => {
    expect(collectSavableMessageImages([
      { type: 'text', text: 'nope' } as Part,
      { type: 'file', mime: 'image/png', filename: 'plot.png', url: 'data:image/png;base64,AAA' } as Part,
    ])).toEqual([{ fileName: 'plot.png', dataUrl: 'data:image/png;base64,AAA' }]);
  });
});
