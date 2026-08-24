import { expect, test } from 'bun:test';

import {
  beginNativeFilePicker,
  endNativeFilePicker,
  isNativeFilePickerActive,
  resetNativeFilePickerForTests,
  withNativeFilePicker,
} from './native-file-picker';

test('is inactive until a picker starts', () => {
  resetNativeFilePickerForTests();
  expect(isNativeFilePickerActive()).toBe(false);
});

test('stays active while a picker is open and briefly after it ends', async () => {
  beginNativeFilePicker();
  expect(isNativeFilePickerActive()).toBe(true);
  endNativeFilePicker();
  expect(isNativeFilePickerActive()).toBe(true);
});

test('withNativeFilePicker marks the picker active during the call', async () => {
  let seenActive = false;
  const result = await withNativeFilePicker(async () => {
    seenActive = isNativeFilePickerActive();
    return 'ok';
  });
  expect(seenActive).toBe(true);
  expect(result).toBe('ok');
  expect(isNativeFilePickerActive()).toBe(true);
});
