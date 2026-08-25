import { toast } from 'sonner';

/**
 * Copied confirmations stay off the shared top-center stack. That stack sits
 * on the chat column and covers the user bubble (#295). Bottom-right is a
 * corner, away from the message list.
 */
export const MESSAGE_COPY_TOAST_POSITION = 'bottom-right' as const;

export const messageCopyToastOptions = {
  position: MESSAGE_COPY_TOAST_POSITION,
} as const;

export function presentMessageCopyToast(ok: boolean, message: string): void {
  if (ok) {
    toast.success(message, messageCopyToastOptions);
    return;
  }
  toast.error(message, messageCopyToastOptions);
}
