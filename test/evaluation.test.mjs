import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, toCSV, NOT_A_SIGN } from '../public/evaluation.mjs';

const t = (target, predicted, bestGloss, distance, confirmGloss = predicted) => ({ target, predicted, confirmGloss, best: { gloss: bestGloss, distance, margin: 0.5 } });

test('computes accuracy, rejection, confusion and false YES', () => {
  const r = summarize([
    t('YES', 'YES', 'YES', 1.0), t('YES', 'YES', 'YES', 1.2), t('YES', null, 'YES', 2.6),
    t('NO', 'NO', 'NO', 0.9), t('NO', 'YES', 'YES', 2.0),
    t(NOT_A_SIGN, null, 'YES', 3.0), t(NOT_A_SIGN, 'YES', 'YES', 2.2)
  ]);
  assert.equal(r.signTrials, 5);
  assert.equal(r.accuracy, 0.6);
  assert.equal(r.rejectionRate, 0.2);
  assert.equal(r.confusionRate, 0.2);
  assert.equal(r.falseYes, 2); // NO→YES and a non-sign→YES
  assert.equal(r.nonYesTrials, 4);
  assert.equal(r.confusion.NO.YES, 1);
  assert.equal(r.confusion[NOT_A_SIGN]['(rejected)'], 1);
});

test('recommends a threshold between genuine and impostor distances', () => {
  const r = summarize([t('YES', 'YES', 'YES', 1.0), t('NO', 'NO', 'NO', 1.4), t(NOT_A_SIGN, null, 'YES', 3.0)]);
  assert.deepEqual(r.threshold, { separable: true, value: 2.2, keepsGenuine: 1 });
  const overlap = summarize([t('YES', 'YES', 'YES', 2.5), t(NOT_A_SIGN, 'YES', 'YES', 2.0)]);
  assert.equal(overlap.threshold.separable, false);
  assert.equal(overlap.threshold.value, 1.9);
});

test('exports CSV with a header row', () => {
  assert.match(toCSV([t('YES', 'YES', 'YES', 1)]).split('\n')[0], /target.*distance/);
});
