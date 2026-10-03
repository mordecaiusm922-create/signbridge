import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Sign output without a synthetic avatar. Deaf community organizations have
// criticized AI signing avatars, so SignBridge shows (1) plain-English captions,
// (2) an ASL gloss outline, and (3) human-recorded clips for the bounded
// vocabulary when they exist in public/signs/<GLOSS>.webm|mp4.

const GLOSS = {
  yes: 'YES', no: 'NO', confirm: 'CONFIRM', cancel: 'CANCEL', cancelled: 'CANCEL', canceled: 'CANCEL',
  reserve: 'RESERVE', reserved: 'RESERVE', table: 'TABLE', buy: 'BUY', call: 'CALL', remind: 'REMIND',
  reminder: 'REMIND', done: 'FINISH', finished: 'FINISH', help: 'HELP', repeat: 'AGAIN', again: 'AGAIN',
  today: 'TODAY', tomorrow: 'TOMORROW', friday: 'FRIDAY', lights: 'LIGHT', door: 'DOOR', understand: 'UNDERSTAND',
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10'
};

export class SignOutput {
  constructor(signsDir = join(process.cwd(), 'public', 'signs')) {
    this.signsDir = signsDir;
  }

  clipFor(gloss) {
    for (const ext of ['webm', 'mp4']) {
      if (existsSync(join(this.signsDir, `${gloss}.${ext}`))) return `/signs/${gloss}.${ext}`;
    }
    return null;
  }

  render(text, { phase = 'response', interactionId = null, glossText = text } = {}) {
    const words = String(glossText).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const gloss = [...new Set(words.map((w) => GLOSS[w] ?? (/^\d+$/.test(w) ? w : null)).filter(Boolean))];
    return {
      type: 'signbridge/signed-response',
      phase,
      interactionId,
      captions: text,
      gloss,
      clips: gloss.map((g) => ({ gloss: g, url: this.clipFor(g) })),
      note: 'Captions are authoritative. Gloss clips are human-recorded when available; no synthetic avatar is used.'
    };
  }
}
