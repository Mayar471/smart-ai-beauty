import { AppError } from './errors.mjs';

const dataUrlPattern = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
const pngSignature = '89504e470d0a1a0a';

export const isPng = (bytes) => bytes.subarray(0, 8).toString('hex') === pngSignature;
export const isJpeg = (bytes) => bytes.subarray(0, 3).toString('hex') === 'ffd8ff';

/**
 * Decodes a browser-normalised PNG data URL and checks its header.
 * Every upload passes through a canvas in the UI, so anything that is not a small valid PNG is rejected.
 */
export function readPngDataUrl(value, { maxBytes, maxSide, message = 'ملف الصورة غير صالح.' }) {
  if (typeof value !== 'string' || !dataUrlPattern.test(value)) throw new AppError(400, message);
  const bytes = Buffer.from(value.slice(22), 'base64');
  if (bytes.length > maxBytes) throw new AppError(413, 'الصورة كبيرة جداً.');
  if (bytes.length < 33 || !isPng(bytes) || bytes.subarray(12, 16).toString() !== 'IHDR')
    throw new AppError(400, message);
  const { width, height } = pngSize(bytes);
  if (!width || !height || width > maxSide || height > maxSide)
    throw new AppError(400, 'أبعاد الصورة غير مدعومة.');
  return bytes;
}

export const pngSize = (bytes) => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });
