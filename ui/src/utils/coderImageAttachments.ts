/**
 * Browser-side intake limits for Coder Chat image attachments.
 *
 * The server accepts JSON requests, so the useful limit is the encoded data
 * URL length rather than only the source file size. Keeping this budget below
 * the server's 25 MB JSON ceiling leaves room for the task and thread fields.
 */
export const CODER_IMAGE_MAX_COUNT = 4;
export const CODER_IMAGE_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const CODER_IMAGE_MAX_DATA_URL_CHARS = 1_200_000;
export const CODER_IMAGE_MAX_TOTAL_DATA_URL_CHARS = 2_800_000;
export const CODER_IMAGE_MAX_EDGE = 2_048;

const SUPPORTED_CODER_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/svg+xml',
]);

export function isSupportedCoderImageType(type: string): boolean {
  return SUPPORTED_CODER_IMAGE_TYPES.has(type.toLowerCase());
}

export function coderImagePayloadChars(images: Array<{ url?: string }>): number {
  return images.reduce((total, image) => total + (typeof image.url === 'string' ? image.url.length : 0), 0);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error(`Could not read "${file.name || 'image'}" as an image.`));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => reject(new Error(`Could not read "${file.name || 'image'}".`));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The image could not be decoded by the browser.'));
    image.src = dataUrl;
  });
}

function candidateDataUrls(
  image: HTMLImageElement,
  original: string,
  mimeType: string,
): Array<{ url: string; mimeType: string }> {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height || typeof document === 'undefined') {
    return [{ url: original, mimeType }];
  }

  const scale = Math.min(1, CODER_IMAGE_MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) return [{ url: original, mimeType }];
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const candidates: Array<{ url: string; mimeType: string }> = [{ url: original, mimeType }];
  const addCandidate = (format: string, quality?: number) => {
    try {
      const url = canvas.toDataURL(format, quality);
      if (url && url !== 'data:,') {
        const actualMimeType = /^data:([^;,]+)/i.exec(url)?.[1]?.toLowerCase() || format;
        candidates.push({ url, mimeType: actualMimeType });
      }
    } catch {
      // Some browsers cannot encode every requested format. The original
      // data URL remains a valid fallback and is checked by the caller.
    }
  };

  const normalizedMimeType = mimeType.toLowerCase();
  if (normalizedMimeType === 'image/jpeg') addCandidate('image/jpeg', 0.82);
  else if (normalizedMimeType === 'image/webp') addCandidate('image/webp', 0.82);
  else addCandidate('image/png');

  // PNG is ideal for screenshots, but a photographic or very detailed PNG can
  // still exceed the transport budget. JPEG is a bounded fallback for those
  // cases; the shortest valid candidate is selected below.
  if (normalizedMimeType !== 'image/jpeg') addCandidate('image/jpeg', 0.82);
  if (normalizedMimeType !== 'image/jpeg') addCandidate('image/jpeg', 0.68);
  return candidates;
}

async function normalizeDataUrl(
  original: string,
  mimeType: string,
): Promise<{ url: string; mimeType: string }> {
  if (typeof window === 'undefined' || typeof Image === 'undefined' || typeof document === 'undefined') {
    return { url: original, mimeType };
  }

  try {
    const image = await loadImage(original);
    const candidates = candidateDataUrls(image, original, mimeType);
    return candidates.reduce((best, candidate) => candidate.url.length < best.url.length ? candidate : best);
  } catch {
    // Browser decoding is an optimization. FileReader's original data URL is
    // still usable when a browser lacks canvas support.
    return { url: original, mimeType };
  }
}

export interface PreparedCoderImage {
  url: string;
  name: string;
  size: number;
  mimeType: string;
}

export async function prepareCoderImage(file: File): Promise<PreparedCoderImage> {
  const mimeType = file.type.toLowerCase();
  const name = file.name || 'Attached image';
  if (!isSupportedCoderImageType(mimeType)) {
    throw new Error(`Only PNG, JPG, WebP, GIF, BMP, and SVG images are supported. "${name}" was skipped.`);
  }
  if (file.size > CODER_IMAGE_MAX_FILE_BYTES) {
    throw new Error(`"${name}" is ${Math.ceil(file.size / (1024 * 1024))} MB. Choose an image no larger than 10 MB.`);
  }

  const original = await readAsDataUrl(file);
  const normalized = mimeType === 'image/svg+xml'
    ? { url: original, mimeType }
    : await normalizeDataUrl(original, mimeType);
  if (normalized.url.length > CODER_IMAGE_MAX_DATA_URL_CHARS) {
    throw new Error(`"${name}" is still too large after compression. Choose a smaller image or screenshot.`);
  }

  return {
    url: normalized.url,
    name,
    size: file.size,
    mimeType: normalized.mimeType,
  };
}
