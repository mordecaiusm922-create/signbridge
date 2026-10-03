import test from 'node:test';
import assert from 'node:assert/strict';
import { TemplateRecognizer, toSequence } from '../server/recognizer.mjs';
import { nod, wave } from './helpers.mjs';

test('learns two signs from few examples and tells them apart', () => {
  const r = new TemplateRecognizer({ rejectDistance: 5 });
  for (const j of [0, 0.004, -0.004]) { r.enroll('yes', nod(j)); r.enroll('NO', wave(j)); }
  assert.deepEqual(r.vocabulary, { YES: 3, NO: 3 });
  assert.equal(r.recognize(nod(0.002)).gloss, 'YES');
  assert.equal(r.recognize(wave(-0.002)).gloss, 'NO');
});
test('rejects a sign that is too far from every template', () => {
  const r = new TemplateRecognizer({ rejectDistance: 0.01 });
  r.enroll('YES', nod());
  const res = r.recognize(wave());
  assert.equal(res.gloss, null);
  assert.equal(res.confidence, 0);
});
test('recordings without hands are rejected', () => {
  assert.throws(() => toSequence([{ leftHand: null, rightHand: null, pose: null }]), /No hands/);
});
