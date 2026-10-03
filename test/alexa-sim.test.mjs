import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.mjs';
import { SignBridge } from '../server/bridge.mjs';
import { JsonStateStore, LocalEvidenceStore } from '../server/store.mjs';

test('simulated Alexa+ drives the confirm loop through real MCP calls', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sb-'));
  const bridge = await new SignBridge({ state: new JsonStateStore(dir), evidence: new LocalEvidenceStore(join(dir, 'ev')) }).init();
  const port = 3990 + Math.floor(Math.random() * 9);
  const { app, simulator } = await createApp({ bridge, port });
  const server = await new Promise((r) => { const s = app.listen(port, '127.0.0.1', () => r(s)); });
  try {
    const one = await simulator.turn({ sessionId: 's1', utterance: 'RESERVE TABLE FOUR FRIDAY 8pm' });
    assert.equal(one.agent, 'scripted');
    assert.deepEqual(one.trace.map((t) => t.tool), ['submit_sign_intent', 'preview_action']);
    assert.equal(one.ui.status, 'awaiting_confirmation');
    assert.ok(one.tools.includes('confirm_action'));

    const unclear = await simulator.turn({ sessionId: 's1', utterance: 'TABLE' });
    assert.equal(unclear.ui.status, 'awaiting_confirmation');

    const hist = await simulator.turn({ sessionId: 's2', utterance: 'what is pending' });
    assert.match(hist.reply, /1 pending: Reserve a table for 4/);

    const yes = await simulator.turn({ sessionId: 's1', utterance: 'YES' });
    assert.deepEqual(yes.trace.map((t) => t.tool), ['confirm_action']);
    assert.equal(yes.ui.status, 'executed');
    assert.equal(yes.pendingId, null);
  } finally {
    await simulator.close();
    server.close();
  }
});
