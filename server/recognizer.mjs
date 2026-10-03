// Few-shot ASL sign recognizer over MediaPipe landmark sequences.
//
// Why this design: fluent ASL recognition is an open research problem and no
// vendor API was available. For the confirm-before-execute loop we only need a
// bounded command vocabulary (YES, NO, CANCEL, HELP, ...). A nearest-neighbour
// classifier with Dynamic Time Warping over normalized hand/pose landmarks can
// learn each sign from ~5 recordings, runs in milliseconds, and never needs the
// raw video (landmarks are extracted in the browser).
//
// Frame format (as produced by public/app.js with MediaPipe Tasks):
//   { leftHand: [[x,y,z] x21] | null, rightHand: [[x,y,z] x21] | null, pose: [[x,y,z] x33] | null }

export const RESAMPLE_LENGTH = 32;
const L_SHOULDER = 11;
const R_SHOULDER = 12;
const HAND_FEATURES = 21 * 2 + 3; // local hand shape (x,y) + wrist position (x,y) + presence

function bodyFrame(pose) {
  if (!pose?.[L_SHOULDER] || !pose?.[R_SHOULDER]) return { cx: 0.5, cy: 0.5, scale: 0.25 };
  const [lx, ly] = pose[L_SHOULDER];
  const [rx, ry] = pose[R_SHOULDER];
  return { cx: (lx + rx) / 2, cy: (ly + ry) / 2, scale: Math.hypot(lx - rx, ly - ry) || 0.25 };
}

function handFeatures(hand, body) {
  if (!Array.isArray(hand) || hand.length !== 21) return new Array(HAND_FEATURES).fill(0);
  const [wx, wy] = hand[0];
  const [mx, my] = hand[9]; // middle-finger MCP: stable hand-size reference
  const size = Math.hypot(mx - wx, my - wy) || 1e-6;
  const out = [];
  for (const [x, y] of hand) out.push((x - wx) / size, (y - wy) / size);
  out.push((wx - body.cx) / body.scale, (wy - body.cy) / body.scale, 1);
  return out;
}

export function frameFeatures(frame) {
  const body = bodyFrame(frame?.pose);
  return [...handFeatures(frame?.leftHand, body), ...handFeatures(frame?.rightHand, body)];
}

function hasHand(frame) {
  return Array.isArray(frame?.leftHand) || Array.isArray(frame?.rightHand);
}

// Trim frames without hands at both ends, then linearly resample to a fixed length.
export function toSequence(frames, length = RESAMPLE_LENGTH) {
  if (!Array.isArray(frames)) throw new Error('frames must be an array');
  let start = frames.findIndex(hasHand);
  if (start === -1) throw new Error('No hands detected in the recording.');
  let end = frames.length - 1;
  while (end > start && !hasHand(frames[end])) end -= 1;
  const feats = frames.slice(start, end + 1).map(frameFeatures);
  if (feats.length === 1) return Array.from({ length }, () => feats[0]);
  return Array.from({ length }, (_, i) => {
    const t = (i * (feats.length - 1)) / (length - 1);
    const lo = Math.floor(t);
    const hi = Math.min(lo + 1, feats.length - 1);
    const w = t - lo;
    return feats[lo].map((v, k) => v * (1 - w) + feats[hi][k] * w);
  });
}

function frameDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

// DTW with a Sakoe-Chiba band, normalized by path length.
export function dtw(a, b, band = Math.ceil(RESAMPLE_LENGTH / 4)) {
  const n = a.length;
  const m = b.length;
  const cost = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(Infinity));
  cost[0][0] = 0;
  for (let i = 1; i <= n; i += 1) {
    for (let j = Math.max(1, i - band); j <= Math.min(m, i + band); j += 1) {
      cost[i][j] = frameDistance(a[i - 1], b[j - 1]) + Math.min(cost[i - 1][j], cost[i][j - 1], cost[i - 1][j - 1]);
    }
  }
  return cost[n][m] / (n + m);
}

export class TemplateRecognizer {
  constructor({ templates = [], rejectDistance = Number(process.env.RECOGNIZER_REJECT_DISTANCE ?? 2.5) } = {}) {
    this.templates = templates; // [{ gloss, sequence }]
    this.rejectDistance = rejectDistance;
  }

  get vocabulary() {
    const counts = {};
    for (const t of this.templates) counts[t.gloss] = (counts[t.gloss] ?? 0) + 1;
    return counts;
  }

  enroll(gloss, frames) {
    const clean = String(gloss ?? '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
    if (!clean) throw new Error('A gloss label (e.g. YES) is required.');
    const template = { gloss: clean, sequence: toSequence(frames) };
    this.templates.push(template);
    return template;
  }

  // Returns ranked candidates (best distance per gloss). `gloss` is null when the
  // best match is too far away: the caller must then ask the user to repeat.
  recognize(frames) {
    if (!this.templates.length) throw new Error('No signs enrolled yet. Teach the recognizer first.');
    const seq = toSequence(frames);
    const best = new Map();
    for (const t of this.templates) {
      const d = dtw(seq, t.sequence);
      if (!best.has(t.gloss) || d < best.get(t.gloss)) best.set(t.gloss, d);
    }
    const ranked = [...best].map(([gloss, distance]) => ({ gloss, distance })).sort((x, y) => x.distance - y.distance);
    const [top, second] = ranked;
    const margin = second ? (second.distance - top.distance) / (second.distance || 1) : 1;
    const accepted = top.distance <= this.rejectDistance;
    return {
      gloss: accepted ? top.gloss : null,
      confidence: accepted ? Number(Math.max(0, Math.min(1, margin)).toFixed(3)) : 0,
      best: { gloss: top.gloss, distance: Number(top.distance.toFixed(4)), margin: Number(margin.toFixed(3)) },
      candidates: ranked.slice(0, 3).map((c) => ({ ...c, distance: Number(c.distance.toFixed(4)) })),
      recognizer: 'dtw-knn'
    };
  }
}
