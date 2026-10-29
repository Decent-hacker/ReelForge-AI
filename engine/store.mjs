import { mkdir, readFile, writeFile, rename, readdir, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { FEATURES } from './quality.mjs';

export const DEFAULT_PREFS = { width: 1080, height: 1920, fps: 30, language: 'auto', pace: 4, zoom: 1.12,
  accent: '#B5F36D', musicVolume: 0.09, captionFont: 'Nirmala UI', instructions: '',
  mandatory: Object.keys(FEATURES).filter(k => k !== 'reference') };
export const CORE = ['transcription','captions','animation','keywords','dimensions','sync','playback'];
export function validatePreferences(p) {
  if (![720,1080].includes(p.width) || ![1280,1920].includes(p.height) || p.width * 16 !== p.height * 9) throw new Error('Select 720×1280 or 1080×1920.');
  if (![24,25,30,60].includes(p.fps)) throw new Error('Unsupported frame rate.');
  if (!Number.isFinite(p.pace) || p.pace < 2 || p.pace > 10 || !Number.isFinite(p.zoom) || p.zoom < 1.01 || p.zoom > 1.3) throw new Error('Invalid pace or zoom.');
  if (!Number.isFinite(p.musicVolume) || p.musicVolume < 0 || p.musicVolume > 0.3 || !/^#[a-f\d]{6}$/i.test(p.accent)) throw new Error('Invalid mix or accent.');
  if (!['auto','hi','en'].includes(p.language) || !['Nirmala UI','Arial'].includes(p.captionFont)) throw new Error('Invalid language or font.');
  if (!Array.isArray(p.mandatory) || p.mandatory.some(k => !FEATURES[k]) || CORE.some(k => !p.mandatory.includes(k))) throw new Error('Required quality features cannot be disabled.');
  if (typeof p.instructions !== 'string' || p.instructions.length > 8000) throw new Error('Instructions too long.');
  return p;
}
export class Store {
  constructor(root) { this.root = path.resolve(root); this.writes = new Map(); }
  dir(id) { if (!/^[a-f\d-]{36}$/.test(id)) throw new Error('Invalid project id.'); return path.join(this.root, id); }
  async save(p) {
    const previous = this.writes.get(p.id) || Promise.resolve();
    const snapshot = JSON.stringify({ ...p, updatedAt: new Date().toISOString() }, null, 2);
    const next = previous.catch(() => {}).then(async () => {
      const dir = this.dir(p.id); await mkdir(dir, { recursive: true });
      const tmp = path.join(dir, `project-${randomUUID()}.tmp`);
      await writeFile(tmp, snapshot, 'utf8');
      // Windows indexers/OneDrive can briefly deny replacement. Keep the old JSON intact and retry only transient locks.
      for(let attempt=0;;attempt++){
        try{await rename(tmp,path.join(dir,'project.json'));break;}
        catch(error){if(attempt>=5||!['EPERM','EBUSY','EACCES'].includes(error.code))throw error;await delay(20*2**attempt);}
      }
      this.onSave?.(JSON.parse(snapshot));
    });
    this.writes.set(p.id, next); await next;
  }
  async create(name = 'Untitled reel') {
    const p = { id: randomUUID(), name: String(name).trim().slice(0,100) || 'Untitled reel', createdAt: new Date().toISOString(), assets: [], preferences: structuredClone(DEFAULT_PREFS), log: [], job: null, plan: null, report: null, output: null, revision: 0 };
    await this.save(p); return p;
  }
  async load(id) { return JSON.parse(await readFile(path.join(this.dir(id), 'project.json'), 'utf8')); }
  async list() {
    await mkdir(this.root, { recursive: true }); const files = await readdir(this.root, { withFileTypes: true });
    const projects = await Promise.all(files.filter(f => f.isDirectory() && /^[a-f\d-]{36}$/.test(f.name)).map(f => this.load(f.name).catch(() => null)));
    return projects.filter(Boolean).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async recover() {
    for (const p of await this.list()) if (['running','queued'].includes(p.job?.status)) {
      p.job.status = 'failed'; p.job.error = 'Application stopped during this job. Retry explicitly; partial files are not completed exports.';
      p.output = null; await this.save(p);
    }
  }
  async assetPath(p, id) {
    const asset = p.assets.find(a => a.id === id); if (!asset) throw new Error('Asset not found.');
    const target = await realpath(path.join(this.dir(p.id), 'assets', asset.file));
    const root = await realpath(path.join(this.dir(p.id), 'assets'));
    if (!target.startsWith(root + path.sep) || !(await stat(target)).isFile()) throw new Error('Invalid asset location.');
    return target;
  }
}
