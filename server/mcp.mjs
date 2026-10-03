import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export const UI_URI = 'ui://signbridge/signed-response.html';
const UI_MIME = 'text/html;profile=mcp-app';
const uiHtml = readFileSync(new URL('../public/mcp-app.html', import.meta.url), 'utf8');

const ok = (payload) => ({ content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: payload });
const fail = (error) => ({ isError: true, content: [{ type: 'text', text: String(error.message ?? error) }] });
const ui = { ui: { resourceUri: UI_URI } };

// Builds one MCP server instance (one per Streamable HTTP session).
export function createMcpServer(bridge) {
  const server = new McpServer({ name: 'signbridge', version: '0.4.0' }, {
    instructions: 'SignBridge lets Deaf ASL users act through Alexa+. Any action with real-world consequences MUST follow submit_sign_intent -> preview_action -> confirm_action. Never execute without an explicit confirmation from the user. Show signed responses on screen devices.'
  });

  const tool = (name, config, fn) => server.registerTool(name, config, async (args) => {
    try { return ok(await fn(args)); } catch (error) { return fail(error); }
  });

  tool('submit_sign_intent', {
    title: 'Submit a signed request',
    description: 'Registers a request recognized from ASL (or typed as fallback). Returns the parsed intent and whether it needs confirmation.',
    inputSchema: {
      text: z.string().min(1).describe('Recognized ASL gloss or English text'),
      source: z.enum(['asl', 'typed']).default('asl'),
      evidence_ref: z.string().optional().describe('Reference to the stored landmark evidence'),
      confidence: z.number().min(0).max(1).optional(),
      user_id: z.string().default('default')
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    _meta: ui
  }, (a) => bridge.submitIntent({ text: a.text, source: a.source, evidenceRef: a.evidence_ref, confidence: a.confidence, userId: a.user_id }));

  tool('preview_action', {
    title: 'Preview an action before executing',
    description: 'Shows the user exactly what will happen, in captions and ASL gloss. Nothing is executed.',
    inputSchema: { interaction_id: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    _meta: ui
  }, (a) => bridge.previewAction({ interactionId: a.interaction_id }));

  tool('confirm_action', {
    title: 'Confirm or cancel a previewed action',
    description: 'Executes only on an explicit, unambiguous YES. Any negation or hesitation cancels; unclear input keeps the action pending.',
    inputSchema: {
      interaction_id: z.string(),
      confirmation: z.string().describe('Recognized ASL gloss or text, e.g. "YES" or "NO"'),
      source: z.enum(['asl', 'typed']).default('asl'),
      evidence_ref: z.string().optional()
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    _meta: ui
  }, (a) => bridge.confirmAction({ interactionId: a.interaction_id, confirmation: a.confirmation, source: a.source, evidenceRef: a.evidence_ref }));

  tool('cancel_action', {
    title: 'Cancel a pending action',
    description: 'Cancels a previewed action without executing it.',
    inputSchema: { interaction_id: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
  }, (a) => bridge.cancelAction({ interactionId: a.interaction_id }));

  tool('get_history', {
    title: 'Recall previous signed interactions',
    description: 'Returns pending actions and recent interactions for this user, across sessions and server restarts.',
    inputSchema: { user_id: z.string().default('default'), limit: z.number().int().min(1).max(50).default(10) },
    annotations: { readOnlyHint: true }
  }, (a) => bridge.history({ userId: a.user_id, limit: a.limit }));

  tool('get_signed_response', {
    title: 'Render a response for an ASL user',
    description: 'Converts an Alexa+ reply into captions, ASL gloss and human-recorded sign clips for on-screen display.',
    inputSchema: { text: z.string().min(1) },
    annotations: { readOnlyHint: true },
    _meta: ui
  }, (a) => bridge.signedResponse({ text: a.text }));

  server.registerResource('signed-response-ui', UI_URI, {
    title: 'SignBridge signed response',
    description: 'MCP Apps view that renders captions, ASL gloss and sign clips on screen devices.',
    mimeType: UI_MIME
  }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: UI_MIME, text: uiHtml }] }));

  return server;
}
