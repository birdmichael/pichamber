export type PersistGeneratedMessageImageOutcome = 'saved' | 'canceled' | 'shared' | 'download-started';

export type VSCodeSaveImageResult = {
  saved?: boolean;
  canceled?: boolean;
  error?: string;
};

export type PersistGeneratedMessageImageDeps = {
  isVSCode: boolean;
  saveVSCodeImage?: (payload: { fileName: string; dataUrl: string }) => Promise<VSCodeSaveImageResult | undefined>;
  isCapacitor: boolean;
  canShareFiles?: (files: File[]) => boolean;
  shareFiles?: (files: File[]) => Promise<void>;
  canUseDesktopSave: boolean;
  saveDesktopImageFile?: (fileName: string, dataUrl: string) => Promise<string | null>;
  downloadInBrowser?: (fileName: string, dataUrl: string) => void;
};

export const triggerBrowserImageDownload = (fileName: string, dataUrl: string): void => {
  const link = document.createElement('a');
  link.download = fileName;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const persistGeneratedMessageImage = async (
  input: { fileName: string; dataUrl: string },
  deps: PersistGeneratedMessageImageDeps,
): Promise<PersistGeneratedMessageImageOutcome> => {
  const { fileName, dataUrl } = input;

  if (deps.isVSCode) {
    const payload = await deps.saveVSCodeImage?.({ fileName, dataUrl });
    if (!payload) {
      throw new Error('Failed to save image in VS Code');
    }
    if (payload.saved !== true) {
      if (payload.canceled) {
        return 'canceled';
      }
      throw new Error(payload.error || 'Failed to save image in VS Code');
    }
    return 'saved';
  }

  if (deps.isCapacitor) {
    const blob = await fetch(dataUrl).then((response) => response.blob());
    const file = new File([blob], fileName, { type: blob.type || 'image/png' });
    if (!deps.canShareFiles?.([file])) {
      throw new Error('Image sharing is unavailable in this mobile runtime');
    }
    await deps.shareFiles?.([file]);
    return 'shared';
  }

  if (deps.canUseDesktopSave) {
    const savedPath = await deps.saveDesktopImageFile?.(fileName, dataUrl);
    if (!savedPath) {
      return 'canceled';
    }
    return 'saved';
  }

  deps.downloadInBrowser?.(fileName, dataUrl);
  return 'download-started';
};
