import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../server/index.mjs';
import { SignBridge } from '../server/bridge.mjs';
import { JsonStateStore, LocalEvidenceStore } from '../server/store.mjs';
import { UI_URI } from '../server/mcp.mjs';

async function start() {
  const dir = await mkdtemp(join(tmpdir(), 'sb-'));
  const bridge = await new SignBridge({ state: new JsonStateStore(dir), evidence: new LocalEvidenceStore(join(dir, 'ev')) }).init();
  const port = 3900 + Math.floor(Math.random() * 90);
  const { app } = await createApp({ bridge, port });
  const server = await new Promise((r) => { const s = app.listen(port, '127.0.0.1', () => r(s)); });
  return { server, url: `http://localhost:${port}/mcp` };
}

test('MCP client completes the confirm-in-ASL loop over Streamable HTTP', async () => {
  const { server, url } = await start();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(url));
  try {
    await client.connect(transport);
    assert.equal(transport.protocolVersion ?? '2025-11-25', '2025-11-25');
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ['cancel_action', 'confirm_action', 'get_history', 'get_signed_response', 'preview_action', 'submit_sign_intent']);
    assert.equal(tools.find((t) => t.name === 'preview_action')._meta.ui.resourceUri, UI_URI);

    const ui = await client.readResource({ uri: UI_URI });
    assert.equal(ui.contents[0].mimeType, 'text/html;profile=mcp-app');

    const sub = await client.callTool({ name: 'submit_sign_intent', arguments: { text: 'RESERVE TABLE FOUR FRIDAY 8pm' } });
    const id = sub.structuredContent.interaction.id;
    const prev = await client.callTool({ name: 'preview_action', arguments: { interaction_id: id } });
    for (const g of ['RESERVE', 'TABLE', '4', 'FRIDAY', 'CONFIRM']) assert.ok(prev.structuredContent.signed.gloss.includes(g), g);
    const conf = await client.callTool({ name: 'confirm_action', arguments: { interaction_id: id, confirmation: 'YES' } });
    assert.equal(conf.structuredContent.status, 'executed');

    const bad = await client.callTool({ name: 'confirm_action', arguments: { interaction_id: 'nope', confirmation: 'YES' } });
    assert.equal(bad.isError, true);
  } finally {
    await client.close();
    server.close();
  }
});

test('rejects requests from untrusted origins (DNS rebinding protection)', async () => {
  const { server, url } = await start();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', origin: 'https://evil.example' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'x', version: '1' } } })
    });
    assert.equal(res.status, 403);
  } finally { server.close(); }
});
