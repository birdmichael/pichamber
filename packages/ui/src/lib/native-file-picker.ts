/**
 * Tracks a native OS file/directory picker so modal dialogs do not treat
 * window blur as a dismiss. Electron's showOpenDialog steals focus; Base UI
 * Dialog then closes Settings before the picker appears.
 */

let nativeFilePickerDepth = 0;
let holdUntilMs = 0;
const HOLD_AFTER_MS = 400;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function beginNativeFilePicker(): void {
  nativeFilePickerDepth += 1;
  notify();
}

export function endNativeFilePicker(): void {
  nativeFilePickerDepth = Math.max(0, nativeFilePickerDepth - 1);
  holdUntilMs = Date.now() + HOLD_AFTER_MS;
  notify();
}

export function isNativeFilePickerActive(): boolean {
  return nativeFilePickerDepth > 0 || Date.now() < holdUntilMs;
}

export function subscribeNativeFilePicker(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetNativeFilePickerForTests(): void {
  nativeFilePickerDepth = 0;
  holdUntilMs = 0;
}

export async function withNativeFilePicker<T>(run: () => Promise<T>): Promise<T> {
  beginNativeFilePicker();
  try {
    return await run();
  } finally {
    endNativeFilePicker();
  }
}
