import type { Part } from '@opencode-ai/sdk/v2';

const isImageMime = (value: unknown): boolean => (
  typeof value === 'string' && value.toLowerCase().startsWith('image/')
);

const asRecord = (value: unknown): Record<string, unknown> | null => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const isImageFilePart = (part: Part | null | undefined): boolean => {
  if (!part) return false;
  const record = asRecord(part);
  if (!record) return false;
  const type = record.type;
  if (type === 'image') return true;
  if (type === 'file') {
    return isImageMime(record.mime) || isImageMime(record.mimeType);
  }
  return false;
};

const attachmentLooksLikeImage = (value: unknown): boolean => {
  const record = asRecord(value);
  if (!record) return false;
  if (record.type === 'image' || record.type === 'file') {
    return record.type === 'image' || isImageMime(record.mime) || isImageMime(record.mimeType);
  }
  return isImageMime(record.mime) || isImageMime(record.mimeType);
};

const partHasImage = (part: Part | null | undefined): boolean => {
  if (!part) return false;
  if (isImageFilePart(part)) return true;

  const state = asRecord((part as { state?: unknown }).state);
  const attachments = state?.attachments;
  if (Array.isArray(attachments) && attachments.some(attachmentLooksLikeImage)) {
    return true;
  }

  return false;
};

export const partsHaveImage = (parts: readonly Part[] | null | undefined): boolean => (
  Boolean(parts?.some(partHasImage))
);

type SavableMessageImage = {
  fileName: string;
  dataUrl: string;
};

const readImageFileName = (record: Record<string, unknown>, fallback: string): string => {
  const filename = record.filename;
  if (typeof filename === 'string' && filename.trim().length > 0) return filename.trim();
  const name = record.name;
  if (typeof name === 'string' && name.trim().length > 0) return name.trim();
  return fallback;
};

const readDataUrl = (record: Record<string, unknown>): string | null => {
  for (const key of ['url', 'source', 'dataUrl'] as const) {
    const value = record[key];
    if (typeof value === 'string' && value.startsWith('data:image/')) {
      return value;
    }
  }
  return null;
};

const collectFromRecord = (record: Record<string, unknown>, collected: SavableMessageImage[]): void => {
  const type = record.type;
  const looksLikeImage = type === 'image'
    || (type === 'file' && (isImageMime(record.mime) || isImageMime(record.mimeType)))
    || isImageMime(record.mime)
    || isImageMime(record.mimeType);
  if (!looksLikeImage) return;
  const dataUrl = readDataUrl(record);
  if (!dataUrl) return;
  collected.push({
    fileName: readImageFileName(record, `image-${collected.length + 1}.png`),
    dataUrl,
  });
};

export const collectSavableMessageImages = (parts: readonly Part[] | null | undefined): SavableMessageImage[] => {
  const collected: SavableMessageImage[] = [];
  if (!parts) return collected;

  for (const part of parts) {
    collectFromRecord(part as unknown as Record<string, unknown>, collected);
    const state = asRecord((part as { state?: unknown }).state);
    const attachments = state?.attachments;
    if (!Array.isArray(attachments)) continue;
    for (const attachment of attachments) {
      const record = asRecord(attachment);
      if (record) collectFromRecord(record, collected);
    }
  }

  return collected;
};
