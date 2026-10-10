import * as fs from 'node:fs';
import * as path from 'node:path';
import { type Settings, defaultSettings, loadSettings } from '../core/config/settings';
import { deepMerge } from '../core/util';

/** settings.json holds preferences only (no secrets, no personal data), so it stays readable for troubleshooting. */
export class SettingsStore {
  private file: string;
  private value: Settings = defaultSettings();
  public loadError: string | null = null;
  private listeners = new Set<(s: Settings, prev: Settings) => void>();

  constructor(dir: string) {
    this.file = path.join(dir, 'settings.json');
  }
  load(): Settings {
    try {
      if (fs.existsSync(this.file)) {
        const r = loadSettings(JSON.parse(fs.readFileSync(this.file, 'utf8')));
        this.value = r.settings;
        this.loadError = r.error ?? null;
        if (r.error) fs.copyFileSync(this.file, this.file + '.invalid');
      }
    } catch (e) {
      this.loadError = (e as Error).message;
    }
    return this.value;
  }
  get(): Settings {
    return this.value;
  }
  onChange(fn: (s: Settings, prev: Settings) => void) {
    this.listeners.add(fn);
  }
  update(patch: Record<string, unknown>): Settings {
    const next = loadSettings(deepMerge(this.value, patch));
    if (next.error) throw new Error('invalid settings: ' + next.error);
    const prev = this.value;
    this.value = next.settings;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.value, null, 2));
    fs.renameSync(this.file + '.tmp', this.file);
    for (const l of this.listeners) l(this.value, prev);
    return this.value;
  }
}
