import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SignBridge } from '../server/bridge.mjs';
import { JsonStateStore, LocalEvidenceStore } from '../server/store.mjs';

async function makeBridge(dir, now = () => Date.now()) {
  return new SignBridge({ state: new JsonStateStore(dir), evidence: new LocalEvidenceStore(join(dir, 'ev')), now }).init();
}

test('full confirm loop executes only after YES and survives a restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sb-'));
  const a = await makeBridge(dir);
  const { interaction } = await a.submitIntent({ text: 'RESERVE TABLE FOUR FRIDAY 8pm', source: 'asl' });
  await assert.rejects(a.confirmAction({ interactionId: interaction.id, confirmation: 'YES' }), /preview_action/);
  await a.previewAction({ interactionId: interaction.id });
  const unclear = await a.confirmAction({ interactionId: interaction.id, confirmation: 'TABLE' });
  assert.equal(unclear.status, 'awaiting_confirmation');

  const b = await makeBridge(dir); // simulated server restart
  assert.equal(b.history().pending[0].id, interaction.id);
  const done = await b.confirmAction({ interactionId: interaction.id, confirmation: 'YES' });
  assert.equal(done.status, 'executed');
  assert.equal(done.receipt.action, 'Reserve a table for 4 on friday at 8pm');
  await assert.rejects(b.confirmAction({ interactionId: interaction.id, confirmation: 'YES' }), /awaiting/);
});

test('negation cancels and pending actions expire', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sb-'));
  let clock = Date.parse('2026-10-01T00:00:00Z');
  const br = await makeBridge(dir, () => clock);
  const one = (await br.submitIntent({ text: 'BUY MILK' })).interaction.id;
  await br.previewAction({ interactionId: one });
  assert.equal((await br.confirmAction({ interactionId: one, confirmation: 'yes, no wait' })).status, 'cancelled');

  const two = (await br.submitIntent({ text: 'CALL MOM' })).interaction.id;
  await br.previewAction({ interactionId: two });
  clock += 11 * 60 * 1000;
  await assert.rejects(br.confirmAction({ interactionId: two, confirmation: 'YES' }), /expired/);
});

test('YES must be clearer than other signs to execute (asymmetric policy)', async () => {
  const { nod, wave } = await import('./helpers.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'sb-'));
  const br = await makeBridge(dir);
  br.recognizer.rejectDistance = 10;
  for (const j of [0, 0.004, -0.004]) { br.recognizer.enroll('YES', nod(j)); br.recognizer.enroll('NO', wave(j)); }
  const sloppy = nod(0.05);
  const normal = br.recognizer.recognize(sloppy);
  assert.equal(normal.gloss, 'YES');
  br.confirmPolicy.maxDistance = normal.best.distance / 2;

  const strict = await br.recognizeConfirmation({ frames: sloppy });
  assert.equal(strict.gloss, null);
  assert.match(strict.reason, /YES must be signed clearly/);
  assert.equal((await br.recognizeConfirmation({ frames: nod(0) })).gloss, 'YES');
  assert.equal((await br.recognizeConfirmation({ frames: wave(0.05) })).gloss, 'NO');
  assert.equal(br.evaluateSign({ frames: sloppy }).confirmGloss, null);
});
