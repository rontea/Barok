import { createRequestEnvelope as createCoreRequestEnvelope, hashRequestText as hashCoreRequestText } from '@barok/core';
import type {
  CreateRequestEnvelopeInput,
  RequestEnvelope,
} from '@barok/core';
import { hashSerializedRequestValue } from '../di/requestEnvelopeHash.js';

export { REQUEST_ENVELOPE_SCHEMA_VERSION } from '@barok/core';
export type {
  CreateRequestEnvelopeInput,
  RequestEnvelope,
  RequestEnvelopeRoute,
  RequestEnvelopeStatus,
} from '@barok/core';

/** Compatibility wrapper for existing Node-side source imports. */
export function createRequestEnvelope(input: CreateRequestEnvelopeInput): RequestEnvelope {
  return createCoreRequestEnvelope(input, hashSerializedRequestValue);
}

/** Compatibility wrapper for existing Node-side source imports. */
export function hashRequestText(text: string): string {
  return hashCoreRequestText(text, hashSerializedRequestValue);
}
