import express from 'express';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { SignBridge } from './bridge.mjs';
import { createMcpServer } from './mcp.mjs';
import { AlexaSimulator } from './alexa-sim.mjs';

const list = (v) => String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

export async function createApp({ bridge, port = Number(process.env.PORT ?? 3000) } = {}) {
  bridge ??= await new SignBridge().init();
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '5mb' })); // landmark sequences, never raw video

  // ---- MCP over Streamable HTTP (spec 2025-11-25) -------------------------
  const allowedHosts = list(process.env.ALLOWED_HOSTS ?? `localhost:${port},127.0.0.1:${port}`);
  const allowedOrigins = list(process.env.ALLOWED_ORIGINS ?? `http://localhost:${port},http://127.0.0.1:${port}`);
  const sessions = new Map();

  app.post('/mcp', async (req, res) => {
    const sid = req.headers['mcp-session-id'];
    let transport = sid ? sessions.get(sid) : undefined;
    if (!transport) {
      if (sid || !isInitializeRequest(req.body)) {
        return res.status(sid ? 404 : 400).json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: sid ? 'Session not found' : 'Missing session; send initialize first' } });
      }
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        enableDnsRebindingProtection: true,
        allowedHosts,
        allowedOrigins,
        onsessioninitialized: (id) => sessions.set(id, transport)
      });
      transport.onclose = () => transport.sessionId && sessions.delete(transport.sessionId);
      await createMcpServer(bridge).connect(transport);
    }
    await transport.handleRequest(req, res, req.body);
  });
  const sessionRequest = async (req, res) => {
    const transport = sessions.get(req.headers['mcp-session-id']);
    if (!transport) return res.status(404).json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Session not found' } });
    await transport.handleRequest(req, res);
  };
  app.get('/mcp', sessionRequest);
  app.delete('/mcp', sessionRequest);

  // ---- Companion web app API -------------------------------------------
  const route = (fn) => async (req, res) => {
    try { res.json(await fn(req.body ?? {})); } catch (error) { res.status(400).json({ error: error.message }); }
  };
  app.get('/health', (_req, res) => res.json({ status: 'ok', vocabulary: bridge.recognizer.vocabulary, storage: process.env.STORAGE_MODE ?? 'local', intent: process.env.INTENT_MODE ?? 'rules', simAgent: process.env.SIM_AGENT ?? 'scripted', pendingTtlMs: Number(process.env.PENDING_TTL_MS ?? 600000) }));
  app.post('/api/signs/enroll', route((b) => bridge.enrollSign(b)));
  app.post('/api/signs/recognize', route((b) => bridge.recognizeSign(b)));
  app.post('/api/signs/confirm', route((b) => bridge.recognizeConfirmation(b)));
  app.post('/api/signs/evaluate', route((b) => bridge.evaluateSign(b)));

  // Simulated Alexa+ host: an MCP client talking to this server's own /mcp.
  const simulator = new AlexaSimulator({ mcpUrl: `http://localhost:${port}/mcp` });
  app.post('/api/alexa/turn', route((b) => simulator.turn(b)));
  app.post('/api/intent', route((b) => bridge.submitIntent(b)));
  app.post('/api/actions/preview', route((b) => bridge.previewAction(b)));
  app.post('/api/actions/confirm', route((b) => bridge.confirmAction(b)));
  app.get('/api/history', (req, res) => res.json(bridge.history({ userId: req.query.userId ?? 'default' })));
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

  return { app, bridge, sessions, simulator };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3000);
  const { app } = await createApp({ port });
  app.listen(port, '127.0.0.1', () => {
    console.log(`SignBridge companion app: http://localhost:${port}`);
    console.log(`MCP endpoint (Streamable HTTP): http://localhost:${port}/mcp`);
  });
}
