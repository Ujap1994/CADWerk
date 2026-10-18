import type { FeatureErrorCode } from './protocol.ts';

/** A feature that cannot be built; the code is shown to the user in their language. */
export class FeatureError extends Error {
  readonly code: FeatureErrorCode;
  readonly detail: string | undefined;

  constructor(code: FeatureErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'FeatureError';
    this.code = code;
    this.detail = detail;
  }
}
