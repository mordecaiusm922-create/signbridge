import { deriveIntent } from './core.mjs';

const KINDS = ['conversation', 'reservation', 'purchase', 'message', 'reminder', 'smart_home'];

// Optional Amazon Bedrock intent parser (INTENT_MODE=bedrock). Turns terse ASL
// gloss ("TABLE FOUR FRIDAY 8PM RESERVE") into a structured action. Falls back
// to the rule parser on any error so the confirm loop never depends on the LLM.
export async function parseIntent(text, { mode = process.env.INTENT_MODE ?? 'rules', modelId = process.env.BEDROCK_MODEL_ID } = {}) {
  const fallback = deriveIntent(text);
  if (mode !== 'bedrock') return fallback;
  if (!modelId) throw new Error('INTENT_MODE=bedrock requires BEDROCK_MODEL_ID.');
  try {
    const { BedrockRuntimeClient, ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');
    const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
    const response = await client.send(new ConverseCommand({
      modelId,
      system: [{ text: `You convert ASL gloss or short English requests into JSON. Reply with JSON only: {"kind": one of ${JSON.stringify(KINDS)}, "slots": object, "english": string}. "english" is a fluent English rendering of the request.` }],
      messages: [{ role: 'user', content: [{ text }] }],
      inferenceConfig: { maxTokens: 300, temperature: 0 }
    }));
    const raw = response.output?.message?.content?.find((c) => c.text)?.text ?? '';
    const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    const kind = KINDS.includes(parsed.kind) ? parsed.kind : fallback.kind;
    return {
      kind,
      text: parsed.english || fallback.text,
      slots: typeof parsed.slots === 'object' && parsed.slots ? parsed.slots : {},
      requiresConfirmation: kind !== 'conversation',
      parser: 'bedrock'
    };
  } catch (error) {
    return { ...fallback, parserError: String(error.message ?? error) };
  }
}
