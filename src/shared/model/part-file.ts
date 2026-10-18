import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Feature } from './feature.ts';
import { parseFeatures, ValidationError } from './validate.ts';

/**
 * Native part file (.pwpart): a ZIP container (docs/adr/0003-native-file-format.md).
 *
 *   document.json  the feature list (source of truth)
 *   meta.json      application version and timestamps
 *
 * Later versions add cached B-Rep data and a thumbnail; readers ignore unknown entries.
 */

export const PART_FORMAT = 'parawerk-part';
export const PART_FORMAT_VERSION = 1;

/** Upper bound for the uncompressed size of one entry, to reject zip bombs. */
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

export interface PartDocument {
  units: 'mm';
  features: Feature[];
}

export interface PartFileMeta {
  appVersion: string;
  savedAt: string;
}

export type PartFileErrorCode = 'not-a-zip' | 'missing-document' | 'wrong-format' | 'newer-version' | 'invalid-content';

export class PartFileError extends Error {
  readonly code: PartFileErrorCode;

  constructor(code: PartFileErrorCode, message: string) {
    super(message);
    this.name = 'PartFileError';
    this.code = code;
  }
}

export function encodePartFile(document: PartDocument, meta: PartFileMeta): Uint8Array {
  const documentJson = {
    format: PART_FORMAT,
    version: PART_FORMAT_VERSION,
    units: document.units,
    features: document.features,
  };
  return zipSync(
    {
      'document.json': strToU8(JSON.stringify(documentJson, null, 2)),
      'meta.json': strToU8(JSON.stringify(meta, null, 2)),
    },
    { level: 6 },
  );
}

export function decodePartFile(bytes: Uint8Array): { document: PartDocument; meta: Partial<PartFileMeta> } {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (file) => {
        if (file.originalSize > MAX_ENTRY_BYTES) {
          throw new PartFileError('invalid-content', `entry ${file.name} is too large`);
        }
        return file.name === 'document.json' || file.name === 'meta.json';
      },
    });
  } catch (error) {
    if (error instanceof PartFileError) throw error;
    throw new PartFileError('not-a-zip', 'the file is not a ParaWerk part file');
  }

  const documentBytes = entries['document.json'];
  if (!documentBytes) throw new PartFileError('missing-document', 'document.json is missing');

  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(documentBytes));
  } catch {
    throw new PartFileError('invalid-content', 'document.json is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null) throw new PartFileError('invalid-content', 'document.json is empty');
  const json = raw as Record<string, unknown>;
  if (json.format !== PART_FORMAT) throw new PartFileError('wrong-format', 'the file is not a ParaWerk part file');
  if (typeof json.version !== 'number' || json.version > PART_FORMAT_VERSION) {
    throw new PartFileError('newer-version', 'the file was saved by a newer ParaWerk version');
  }
  if (json.units !== 'mm') throw new PartFileError('invalid-content', 'unsupported units');

  let features: Feature[];
  try {
    features = parseFeatures(json.features);
  } catch (error) {
    if (error instanceof ValidationError) throw new PartFileError('invalid-content', error.message);
    throw error;
  }

  let meta: Partial<PartFileMeta> = {};
  const metaBytes = entries['meta.json'];
  if (metaBytes) {
    try {
      const parsed: unknown = JSON.parse(strFromU8(metaBytes));
      if (typeof parsed === 'object' && parsed !== null) meta = parsed as Partial<PartFileMeta>;
    } catch {
      // Metadata is informational; a damaged meta.json must not prevent opening the part.
    }
  }

  return { document: { units: 'mm', features }, meta };
}
