import { beforeEach, describe, expect, mock, test } from 'bun:test';

const sonnerToastCalls = {
  success: [] as Array<{ message: unknown; options: unknown }>,
  error: [] as Array<{ message: unknown; options: unknown }>,
};

mock.module('sonner', () => ({
  toast: {
    success: (message: unknown, options: unknown) => {
      sonnerToastCalls.success.push({ message, options });
    },
    error: (message: unknown, options: unknown) => {
      sonnerToastCalls.error.push({ message, options });
    },
  },
}));

import {
  MESSAGE_COPY_TOAST_POSITION,
  messageCopyToastOptions,
  presentMessageCopyToast,
} from './messageCopyToast';

describe('messageCopyToast', () => {
  beforeEach(() => {
    sonnerToastCalls.success.length = 0;
    sonnerToastCalls.error.length = 0;
  });

  test('keeps copy confirmations off the top-center message column', () => {
    expect(MESSAGE_COPY_TOAST_POSITION).toBe('bottom-right');
    expect(messageCopyToastOptions).toEqual({ position: 'bottom-right' });
    expect(MESSAGE_COPY_TOAST_POSITION).not.toBe('top-center');
  });

  test('presents Copied and copy-failed on the corner stack', () => {
    presentMessageCopyToast(true, 'Copied');
    presentMessageCopyToast(false, 'Failed to copy');

    expect(sonnerToastCalls.success).toEqual([
      { message: 'Copied', options: { position: 'bottom-right' } },
    ]);
    expect(sonnerToastCalls.error).toEqual([
      { message: 'Failed to copy', options: { position: 'bottom-right' } },
    ]);
  });
});
