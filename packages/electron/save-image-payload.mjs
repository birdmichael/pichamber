const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const isPngBuffer = (bytes) => (
  Buffer.isBuffer(bytes)
  && bytes.length >= PNG_MAGIC.length
  && bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)
);

const decodeBase64Png = (value, errorMessage) => {
  const bytes = Buffer.from(value, 'base64');
  if (!isPngBuffer(bytes)) {
    throw new Error(errorMessage);
  }
  return bytes;
};

export const decodeDesktopImagePayload = (args = {}) => {
  const dataUrl = typeof args.dataUrl === 'string' ? args.dataUrl.trim() : '';
  const base64 = typeof args.base64 === 'string' ? args.base64.trim() : '';

  if (dataUrl) {
    if (!dataUrl.startsWith('data:image/png')) {
      throw new Error('Image payload must be a PNG');
    }
    const commaIndex = dataUrl.indexOf(',');
    if (commaIndex === -1) {
      throw new Error('Invalid image data URL');
    }
    return decodeBase64Png(dataUrl.slice(commaIndex + 1), 'Image payload must be a PNG');
  }

  if (base64) {
    return decodeBase64Png(base64, 'Image payload must be a PNG');
  }

  throw new Error('Image payload is required');
};
