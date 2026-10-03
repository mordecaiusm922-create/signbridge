// Synthetic landmark sequences: a hand that moves along a path with a given shape.
export function signFrames({ path, curl = 0, frames = 20, lead = 3, hand = 'rightHand' }) {
  const pose = Array.from({ length: 33 }, () => [0.5, 0.5, 0]);
  pose[11] = [0.6, 0.6, 0];
  pose[12] = [0.4, 0.6, 0];
  const out = [];
  for (let k = 0; k < lead; k += 1) out.push({ leftHand: null, rightHand: null, pose });
  for (let f = 0; f < frames; f += 1) {
    const t = f / (frames - 1);
    const [wx, wy] = path(t);
    const lm = Array.from({ length: 21 }, (_, i) => {
      const finger = Math.floor((i - 1) / 4);
      const joint = (i - 1) % 4;
      if (i === 0) return [wx, wy, 0];
      const len = 0.02 * (joint + 1) * (1 - curl * (joint / 3));
      return [wx + (finger - 2) * 0.012, wy - len, 0];
    });
    out.push({ leftHand: null, rightHand: null, [hand]: lm, pose });
  }
  for (let k = 0; k < lead; k += 1) out.push({ leftHand: null, rightHand: null, pose });
  return out;
}
export const nod = (jitter = 0) => signFrames({ curl: 0.9, path: (t) => [0.5 + jitter, 0.5 + 0.08 * Math.sin(t * Math.PI * 4)] });
export const wave = (jitter = 0) => signFrames({ curl: 0, path: (t) => [0.45 + 0.1 * t + jitter, 0.45] });
