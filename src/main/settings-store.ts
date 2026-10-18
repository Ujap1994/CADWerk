import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from '../shared/settings.ts';

/** Reads and writes a small JSON file atomically (write to a temp file, then rename). */
export class JsonFile<T> {
  private readonly file: string;

  constructor(file: string) {
    this.file = file;
  }

  read(): unknown {
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
    } catch {
      return undefined;
    }
  }

  write(value: T): void {
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.tmp`;
      writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
      renameSync(temp, this.file);
    } catch (error) {
      console.error(`Could not write ${this.file}`, error);
    }
  }
}

export class SettingsStore {
  private readonly storage: JsonFile<Settings>;
  private current: Settings;

  constructor(file: string) {
    this.storage = new JsonFile<Settings>(file);
    this.current = sanitizeSettings(this.storage.read(), DEFAULT_SETTINGS);
  }

  get(): Settings {
    return this.current;
  }

  update(patch: unknown): Settings {
    const merged = typeof patch === 'object' && patch !== null ? { ...this.current, ...patch } : this.current;
    this.current = sanitizeSettings(merged, this.current);
    this.storage.write(this.current);
    return this.current;
  }
}
