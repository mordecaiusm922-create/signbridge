import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Simulated Alexa+ host (hackathon rules, Alexa+ track: "a simulated Alexa+
// experience built with any agentic tool"). It is a genuine MCP client: it
// connects to SignBridge's /mcp endpoint over Streamable HTTP, discovers the
// tools, calls them, and renders the MCP Apps view — exactly what Alexa+ does.
//
// Two agents:
//   SIM_AGENT=bedrock  Amazon Bedrock Converse with tool use decides which MCP
//                      tools to call (agentic; needs BEDROCK_MODEL_ID + AWS creds).
//   SIM_AGENT=scripted Deterministic orchestrator (default; works offline).

const SYSTEM = `You are Alexa+, talking with a Deaf user who signs in ASL. Their messages are ASL gloss recognized by SignBridge (or typed).
Rules:
- For any request with real-world consequences, call submit_sign_intent, then preview_action. Never call confirm_action unless the user's latest message is an explicit YES or NO answering a preview.
- When the user answers YES/NO, call confirm_action with their exact words.
- For questions, answer briefly and call get_signed_response with your answer so it is shown in captions and ASL.
- If the user asks what is pending or what they did before, call get_history.
- Keep replies to one or two short sentences.`;

const MAX_STEPS = 6;

export class AlexaSimulator {
  constructor({ mcpUrl, agent = process.env.SIM_AGENT ?? 'scripted', modelId = process.env.BEDROCK_MODEL_ID } = {}) {
    this.mcpUrl = mcpUrl;
    this.agent = agent;
    this.modelId = modelId;
    this.sessions = new Map();
  }

  async session(id) {
    if (this.sessions.has(id)) return this.sessions.get(id);
    const client = new Client({ name: 'alexa-plus-simulator', version: '0.4.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(this.mcpUrl)));
    const { tools } = await client.listTools();
    const s = { id, client, tools, messages: [], pendingId: null, trace: [] };
    this.sessions.set(id, s);
    return s;
  }

  async call(s, name, args) {
    const res = await s.client.callTool({ name, arguments: args });
    const step = { tool: name, arguments: args, isError: Boolean(res.isError), result: res.structuredContent ?? res.content?.[0]?.text };
    s.turnTrace.push(step);
    if (!res.isError && res.structuredContent) {
      const sc = res.structuredContent;
      s.ui = sc.signed ? sc : sc.captions ? { signed: sc } : s.ui;
      const status = sc.status ?? sc.interaction?.status;
      const id = sc.interactionId ?? sc.interaction?.id;
      if (status === 'awaiting_confirmation') s.pendingId = id;
      else if (['executed', 'cancelled'].includes(status) && id === s.pendingId) s.pendingId = null;
    }
    return res;
  }

  async turn({ sessionId = randomUUID(), utterance, source = 'asl', userId = 'default' }) {
    const s = await this.session(sessionId);
    s.turnTrace = [];
    s.ui = null;
    let reply;
    let agent = this.agent;
    if (agent === 'bedrock') {
      try { reply = await this.bedrockTurn(s, utterance, source, userId); } catch (error) {
        s.turnTrace.push({ tool: 'bedrock', isError: true, result: String(error.message ?? error) });
        agent = 'scripted (bedrock failed)';
      }
    }
    if (reply === undefined) reply = await this.scriptedTurn(s, utterance, source, userId);
    return { sessionId: s.id, agent, reply, trace: s.turnTrace, ui: s.ui, pendingId: s.pendingId, tools: s.tools.map((t) => t.name) };
  }

  async scriptedTurn(s, utterance, source, userId) {
    // While an action awaits confirmation, every turn is treated as the answer:
    // unclear answers keep it pending and re-ask; the user signs NO to move on.
    if (s.pendingId) {
      const res = await this.call(s, 'confirm_action', { interaction_id: s.pendingId, confirmation: utterance, source });
      return res.isError ? res.content[0].text : res.structuredContent.signed.captions;
    }
    if (/\b(history|pending|before|remember)\b/i.test(utterance)) {
      const h = (await this.call(s, 'get_history', { user_id: userId })).structuredContent;
      const text = h.pending.length ? `You have ${h.pending.length} pending: ${h.pending.map((p) => p.action).join('; ')}.` : 'Nothing is pending.';
      await this.call(s, 'get_signed_response', { text });
      return text;
    }
    const sub = await this.call(s, 'submit_sign_intent', { text: utterance, source, user_id: userId });
    if (sub.isError) return sub.content[0].text;
    const { interaction } = sub.structuredContent;
    if (!interaction.intent.requiresConfirmation) return sub.structuredContent.signed.captions;
    const prev = await this.call(s, 'preview_action', { interaction_id: interaction.id });
    return prev.isError ? prev.content[0].text : prev.structuredContent.signed.captions;
  }

  async bedrockTurn(s, utterance, source, userId) {
    if (!this.modelId) throw new Error('SIM_AGENT=bedrock requires BEDROCK_MODEL_ID.');
    const { BedrockRuntimeClient, ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');
    this.bedrock ??= new BedrockRuntimeClient({ region: process.env.AWS_REGION });
    const toolConfig = { tools: s.tools.map((t) => ({ toolSpec: { name: t.name, description: t.description, inputSchema: { json: t.inputSchema } } })) };
    const context = `[source=${source}; user_id=${userId}${s.pendingId ? `; pending interaction_id=${s.pendingId}` : ''}] ${utterance}`;
    s.messages.push({ role: 'user', content: [{ text: context }] });
    for (let step = 0; step < MAX_STEPS; step += 1) {
      const out = await this.bedrock.send(new ConverseCommand({
        modelId: this.modelId, system: [{ text: SYSTEM }], messages: s.messages, toolConfig,
        inferenceConfig: { maxTokens: 500, temperature: 0 }
      }));
      const message = out.output.message;
      s.messages.push(message);
      const uses = message.content.filter((c) => c.toolUse).map((c) => c.toolUse);
      if (out.stopReason !== 'tool_use' || !uses.length) {
        return message.content.filter((c) => c.text).map((c) => c.text).join(' ').trim();
      }
      const results = [];
      for (const use of uses) {
        const res = await this.call(s, use.name, use.input ?? {});
        results.push({ toolResult: { toolUseId: use.toolUseId, status: res.isError ? 'error' : 'success', content: [res.structuredContent ? { json: res.structuredContent } : { text: res.content?.[0]?.text ?? '' }] } });
      }
      s.messages.push({ role: 'user', content: results });
    }
    return 'Sorry, I could not finish that request.';
  }

  async close() {
    for (const s of this.sessions.values()) await s.client.close().catch(() => {});
    this.sessions.clear();
  }
}
