import { describe, expect, it } from '@jest/globals';
import {
  CODER_IMAGE_MAX_COUNT,
  CODER_IMAGE_MAX_DATA_URL_CHARS,
  CODER_IMAGE_MAX_TOTAL_DATA_URL_CHARS,
  coderImagePayloadChars,
  isSupportedCoderImageType,
} from '../../ui/src/utils/coderImageAttachments';

describe('Coder Chat image attachment limits', () => {
  it('accepts supported browser image types and rejects non-images', () => {
    expect(isSupportedCoderImageType('image/png')).toBe(true);
    expect(isSupportedCoderImageType('IMAGE/JPEG')).toBe(true);
    expect(isSupportedCoderImageType('text/plain')).toBe(false);
  });

  it('keeps the encoded image budget below the JSON request ceiling', () => {
    const images = Array.from({ length: CODER_IMAGE_MAX_COUNT }, (_, index) => ({
      url: `data:image/png;base64,${'a'.repeat(index === 0 ? CODER_IMAGE_MAX_DATA_URL_CHARS - 22 : 100)}`,
    }));
    expect(coderImagePayloadChars(images)).toBeLessThan(CODER_IMAGE_MAX_TOTAL_DATA_URL_CHARS);
  });
});
