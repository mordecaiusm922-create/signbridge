import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveIntent, describeAction, parseConfirmation } from '../server/core.mjs';

test('confirmation requires an unambiguous affirmative', () => {
  for (const t of ['YES', 'yes', 'Yes, confirm', 'CONFIRM', 'go ahead']) assert.equal(parseConfirmation(t), 'confirm', t);
});
test('negation or hesitation always cancels', () => {
  for (const t of ['NO', 'yes, no wait', 'ok no', 'yes but cancel', 'not now', 'maybe']) assert.equal(parseConfirmation(t), 'cancel', t);
});
test('anything else is unclear and does not execute', () => {
  for (const t of ['', 'ok', 'sure thing', 'TABLE']) assert.equal(parseConfirmation(t), 'unclear', t);
});
test('reservation from ASL gloss extracts slots and needs confirmation', () => {
  const i = deriveIntent('RESERVE TABLE FOUR FRIDAY 8pm');
  assert.equal(i.kind, 'reservation');
  assert.equal(i.requiresConfirmation, true);
  assert.deepEqual(i.slots, { partySize: 4, day: 'friday', time: '8pm' });
  assert.equal(describeAction(i), 'Reserve a table for 4 on friday at 8pm');
});
test('plain questions do not require confirmation', () => {
  assert.equal(deriveIntent('WEATHER TODAY').requiresConfirmation, false);
});
