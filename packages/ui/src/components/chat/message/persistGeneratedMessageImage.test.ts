import { describe, expect, mock, test } from 'bun:test';

import { persistGeneratedMessageImage } from './persistGeneratedMessageImage';

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

describe('persistGeneratedMessageImage', () => {
  test('Desktop save calls the IPC helper and reports saved', async () => {
    const saveDesktopImageFile = mock(async (fileName: string, dataUrl: string) => {
      expect(fileName).toBe('message-1.png');
      expect(dataUrl).toBe(PNG_DATA_URL);
      return '/tmp/message-1.png';
    });
    const downloadInBrowser = mock(() => {
      throw new Error('browser download must not run on Desktop');
    });

    await expect(persistGeneratedMessageImage(
      { fileName: 'message-1.png', dataUrl: PNG_DATA_URL },
      {
        isVSCode: false,
        isCapacitor: false,
        canUseDesktopSave: true,
        saveDesktopImageFile,
        downloadInBrowser,
      },
    )).resolves.toBe('saved');

    expect(saveDesktopImageFile).toHaveBeenCalledTimes(1);
    expect(downloadInBrowser).not.toHaveBeenCalled();
  });

  test('Desktop cancel is silent and does not fall back to a download', async () => {
    const saveDesktopImageFile = mock(async () => null);
    const downloadInBrowser = mock(() => {
      throw new Error('browser download must not run after Desktop cancel');
    });

    await expect(persistGeneratedMessageImage(
      { fileName: 'message-1.png', dataUrl: PNG_DATA_URL },
      {
        isVSCode: false,
        isCapacitor: false,
        canUseDesktopSave: true,
        saveDesktopImageFile,
        downloadInBrowser,
      },
    )).resolves.toBe('canceled');

    expect(saveDesktopImageFile).toHaveBeenCalledTimes(1);
    expect(downloadInBrowser).not.toHaveBeenCalled();
  });

  test('Desktop write failure propagates so the caller can toast failure', async () => {
    await expect(persistGeneratedMessageImage(
      { fileName: 'message-1.png', dataUrl: PNG_DATA_URL },
      {
        isVSCode: false,
        isCapacitor: false,
        canUseDesktopSave: true,
        saveDesktopImageFile: async () => {
          throw new Error('disk full');
        },
      },
    )).rejects.toThrow('disk full');
  });

  test('VS Code cancel stays silent', async () => {
    const saveVSCodeImage = mock(async () => ({ saved: false, canceled: true }));

    await expect(persistGeneratedMessageImage(
      { fileName: 'message-1.png', dataUrl: PNG_DATA_URL },
      {
        isVSCode: true,
        saveVSCodeImage,
        isCapacitor: false,
        canUseDesktopSave: false,
      },
    )).resolves.toBe('canceled');

    expect(saveVSCodeImage).toHaveBeenCalledTimes(1);
  });

  test('VS Code save reports saved', async () => {
    await expect(persistGeneratedMessageImage(
      { fileName: 'message-1.png', dataUrl: PNG_DATA_URL },
      {
        isVSCode: true,
        saveVSCodeImage: async () => ({ saved: true }),
        isCapacitor: false,
        canUseDesktopSave: false,
      },
    )).resolves.toBe('saved');
  });

  test('web download does not claim a saved file', async () => {
    const downloadInBrowser = mock(() => undefined);

    await expect(persistGeneratedMessageImage(
      { fileName: 'message-1.png', dataUrl: PNG_DATA_URL },
      {
        isVSCode: false,
        isCapacitor: false,
        canUseDesktopSave: false,
        downloadInBrowser,
      },
    )).resolves.toBe('download-started');

    expect(downloadInBrowser).toHaveBeenCalledTimes(1);
  });
});
