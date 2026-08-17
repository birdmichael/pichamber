import { describe, expect, test } from 'bun:test';

import { persistGeneratedMessageImage } from './persistGeneratedMessageImage';

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

describe('persistGeneratedMessageImage', () => {
  test('Desktop save calls the IPC helper and reports saved', async () => {
    const desktopCalls: Array<{ fileName: string; dataUrl: string }> = [];
    let browserDownloadCalls = 0;

    const outcome = await persistGeneratedMessageImage(
      { fileName: 'message-1.png', dataUrl: PNG_DATA_URL },
      {
        isVSCode: false,
        isCapacitor: false,
        canUseDesktopSave: true,
        saveDesktopImageFile: async (fileName, dataUrl) => {
          desktopCalls.push({ fileName, dataUrl });
          return '/tmp/message-1.png';
        },
        downloadInBrowser: () => {
          browserDownloadCalls += 1;
        },
      },
    );

    expect(outcome).toBe('saved');
    expect(desktopCalls).toEqual([{ fileName: 'message-1.png', dataUrl: PNG_DATA_URL }]);
    expect(browserDownloadCalls).toBe(0);
  });

  test('Desktop cancel is silent and does not fall back to a download', async () => {
    let desktopCalls = 0;
    let browserDownloadCalls = 0;

    const outcome = await persistGeneratedMessageImage(
      { fileName: 'message-1.png', dataUrl: PNG_DATA_URL },
      {
        isVSCode: false,
        isCapacitor: false,
        canUseDesktopSave: true,
        saveDesktopImageFile: async () => {
          desktopCalls += 1;
          return null;
        },
        downloadInBrowser: () => {
          browserDownloadCalls += 1;
        },
      },
    );

    expect(outcome).toBe('canceled');
    expect(desktopCalls).toBe(1);
    expect(browserDownloadCalls).toBe(0);
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
    const vscodeCalls: Array<{ fileName: string; dataUrl: string }> = [];

    const outcome = await persistGeneratedMessageImage(
      { fileName: 'message-1.png', dataUrl: PNG_DATA_URL },
      {
        isVSCode: true,
        saveVSCodeImage: async (payload) => {
          vscodeCalls.push(payload);
          return { saved: false, canceled: true };
        },
        isCapacitor: false,
        canUseDesktopSave: false,
      },
    );

    expect(outcome).toBe('canceled');
    expect(vscodeCalls).toEqual([{ fileName: 'message-1.png', dataUrl: PNG_DATA_URL }]);
  });

  test('VS Code save reports saved', async () => {
    const outcome = await persistGeneratedMessageImage(
      { fileName: 'message-1.png', dataUrl: PNG_DATA_URL },
      {
        isVSCode: true,
        saveVSCodeImage: async () => ({ saved: true }),
        isCapacitor: false,
        canUseDesktopSave: false,
      },
    );

    expect(outcome).toBe('saved');
  });

  test('web download does not claim a saved file', async () => {
    let browserDownloadCalls = 0;

    const outcome = await persistGeneratedMessageImage(
      { fileName: 'message-1.png', dataUrl: PNG_DATA_URL },
      {
        isVSCode: false,
        isCapacitor: false,
        canUseDesktopSave: false,
        downloadInBrowser: () => {
          browserDownloadCalls += 1;
        },
      },
    );

    expect(outcome).toBe('download-started');
    expect(browserDownloadCalls).toBe(1);
  });
});
