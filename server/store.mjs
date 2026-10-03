import { mkdir, readFile, rename, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Durable state (interactions, per-user history, sign templates) in a JSON file
// written atomically, so a server restart keeps context across sessions.
export class JsonStateStore {
  constructor(dir = process.env.DATA_DIR ?? join(process.cwd(), 'data')) {
    this.dir = dir;
    this.file = join(dir, 'state.json');
    this.auditFile = join(dir, 'audit.jsonl');
    this.state = null;
    this.queue = Promise.resolve();
  }

  async load() {
    if (this.state) return this.state;
    try {
      this.state = JSON.parse(await readFile(this.file, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.state = { interactions: {}, templates: [] };
    }
    this.state.interactions ??= {};
    this.state.templates ??= [];
    return this.state;
  }

  save() {
    this.queue = this.queue.then(async () => {
      await mkdir(this.dir, { recursive: true });
      const tmp = `${this.file}.${randomUUID()}.tmp`;
      await writeFile(tmp, JSON.stringify(this.state));
      await rename(tmp, this.file);
    });
    return this.queue;
  }

  async audit(event) {
    await mkdir(this.dir, { recursive: true });
    await appendFile(this.auditFile, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
  }
}

// Evidence store for the landmark sequence behind every recognized sign.
// Landmarks, not raw video: the camera feed never leaves the browser.
export class LocalEvidenceStore {
  constructor(dir = join(process.env.DATA_DIR ?? join(process.cwd(), 'data'), 'evidence')) {
    this.dir = dir;
  }

  async put(frames) {
    await mkdir(this.dir, { recursive: true });
    const id = `${randomUUID()}.json`;
    await writeFile(join(this.dir, id), JSON.stringify(frames));
    return `local://signbridge/evidence/${id}`;
  }
}

export class S3EvidenceStore {
  constructor({ bucket = process.env.S3_BUCKET, region = process.env.AWS_REGION, prefix = 'evidence/' } = {}) {
    if (!bucket) throw new Error('STORAGE_MODE=s3 requires S3_BUCKET.');
    this.bucket = bucket;
    this.region = region;
    this.prefix = prefix;
  }

  async put(frames) {
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    this.client ??= new S3Client({ region: this.region });
    const key = `${this.prefix}${new Date().toISOString().slice(0, 10)}/${randomUUID()}.json`;
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: JSON.stringify(frames),
      ContentType: 'application/json',
      ServerSideEncryption: 'AES256'
    }));
    return `s3://${this.bucket}/${key}`;
  }
}

export function createEvidenceStore(mode = process.env.STORAGE_MODE ?? 'local') {
  return mode === 's3' ? new S3EvidenceStore() : new LocalEvidenceStore();
}
