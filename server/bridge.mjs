import { randomUUID } from 'node:crypto';
import { describeAction, normalizeText, parseConfirmation } from './core.mjs';
import { parseIntent } from './intent.mjs';
import { TemplateRecognizer } from './recognizer.mjs';
import { SignOutput } from './sign-output.mjs';
import { JsonStateStore, createEvidenceStore } from './store.mjs';

const AFFIRM_GLOSSES = new Set(['YES', 'CONFIRM']);
const PENDING_TTL_MS = Number(process.env.PENDING_TTL_MS ?? 10 * 60 * 1000);

// The SignBridge service. Both the MCP server and the companion web app call it,
// so Alexa+ and the browser always see the same state machine:
//   received -> awaiting_confirmation -> executed | cancelled | expired
export class SignBridge {
  constructor({ state = new JsonStateStore(), evidence = createEvidenceStore(), output = new SignOutput(), now = () => Date.now(), confirmPolicy = {} } = {}) {
    this.confirmPolicy = {
      maxDistance: Number(process.env.CONFIRM_REJECT_DISTANCE ?? NaN),
      minMargin: Number(process.env.CONFIRM_MIN_MARGIN ?? 0.2),
      ...confirmPolicy
    };
    this.state = state;
    this.evidence = evidence;
    this.output = output;
    this.now = now;
    this.recognizer = null;
  }

  async init() {
    const s = await this.state.load();
    this.recognizer = new TemplateRecognizer({ templates: s.templates });
    if (!Number.isFinite(this.confirmPolicy.maxDistance)) this.confirmPolicy.maxDistance = this.recognizer.rejectDistance * 0.6;
    return this;
  }

  async enrollSign({ gloss, frames }) {
    const t = this.recognizer.enroll(gloss, frames);
    await this.state.save();
    await this.state.audit({ event: 'sign_enrolled', gloss: t.gloss });
    return { gloss: t.gloss, vocabulary: this.recognizer.vocabulary };
  }

  async recognizeSign({ frames }) {
    const result = this.recognizer.recognize(frames);
    const evidenceRef = await this.evidence.put(frames);
    await this.state.audit({ event: 'sign_recognized', evidenceRef, gloss: result.gloss, confidence: result.confidence });
    return { ...result, evidenceRef };
  }

  // Asymmetric safety policy for confirmations: a sign that EXECUTES (YES,
  // CONFIRM) must be closer to its templates and clearly separated from the
  // runner-up; a sign that cancels only needs the normal threshold, because
  // cancelling by mistake is cheap and executing by mistake is not.
  confirmationGloss(result) {
    const { gloss, distance, margin } = result.best;
    if (AFFIRM_GLOSSES.has(gloss)) {
      const clear = distance <= this.confirmPolicy.maxDistance && margin >= this.confirmPolicy.minMargin;
      return clear ? { gloss } : { gloss: null, reason: 'To execute, YES must be signed clearly. Please sign it again.' };
    }
    return result.gloss ? { gloss: result.gloss } : { gloss: null, reason: 'I am not sure what that sign was. Please sign it again.' };
  }

  async recognizeConfirmation({ frames }) {
    const result = this.recognizer.recognize(frames);
    const decision = this.confirmationGloss(result);
    const evidenceRef = await this.evidence.put(frames);
    await this.state.audit({ event: 'confirmation_sign_recognized', evidenceRef, best: result.best, gloss: decision.gloss });
    return { ...result, ...decision, strict: true, evidenceRef };
  }

  // Evaluation mode: same recognizer and policy, nothing stored.
  evaluateSign({ frames }) {
    const result = this.recognizer.recognize(frames);
    return { ...result, confirmGloss: this.confirmationGloss(result).gloss, policy: { rejectDistance: this.recognizer.rejectDistance, ...this.confirmPolicy } };
  }

  interaction(id) {
    const it = this.state.state.interactions[id];
    if (!it) throw new Error(`Interaction ${id} not found.`);
    if (it.status === 'awaiting_confirmation' && this.now() - Date.parse(it.previewedAt) > PENDING_TTL_MS) {
      it.status = 'expired';
    }
    return it;
  }

  // Step 1: a recognized (or typed) request arrives.
  async submitIntent({ text, source = 'typed', evidenceRef = null, confidence = null, userId = 'default' }) {
    const clean = normalizeText(text);
    if (!clean) throw new Error('text is required.');
    const intent = await parseIntent(clean);
    const id = randomUUID();
    const it = {
      id, userId, source, evidenceRef, confidence, intent,
      action: intent.requiresConfirmation ? describeAction(intent) : null,
      status: 'received',
      createdAt: new Date(this.now()).toISOString()
    };
    this.state.state.interactions[id] = it;
    await this.state.save();
    await this.state.audit({ event: 'intent_received', interactionId: id, userId, source, evidenceRef, kind: intent.kind, text: clean });
    const message = intent.requiresConfirmation
      ? `I understood a request: ${it.action}. Nothing happens until you confirm.`
      : `I understood: ${intent.text}`;
    return { interaction: it, signed: this.output.render(message, { phase: 'intent', interactionId: id, glossText: it.action ?? intent.text }) };
  }

  // Step 2: show exactly what will happen; nothing executes yet.
  async previewAction({ interactionId }) {
    const it = this.interaction(interactionId);
    if (!it.intent.requiresConfirmation) throw new Error('This interaction has no action to confirm.');
    if (!['received', 'awaiting_confirmation'].includes(it.status)) throw new Error(`Interaction is already ${it.status}.`);
    it.status = 'awaiting_confirmation';
    it.previewedAt = new Date(this.now()).toISOString();
    await this.state.save();
    await this.state.audit({ event: 'action_previewed', interactionId, action: it.action });
    return {
      interactionId, status: it.status, action: it.action,
      signed: this.output.render(`Please confirm: ${it.action}. Sign YES to confirm or NO to cancel.`, { phase: 'preview', interactionId, glossText: `${it.action} confirm` })
    };
  }

  // Step 3: explicit confirmation executes; negation or hesitation cancels;
  // anything unclear keeps the action pending and asks again.
  async confirmAction({ interactionId, confirmation, source = 'typed', evidenceRef = null }) {
    const it = this.interaction(interactionId);
    if (it.status === 'expired') {
      await this.state.save();
      throw new Error('The confirmation window expired. Preview the action again.');
    }
    if (it.status !== 'awaiting_confirmation') throw new Error('No action is awaiting confirmation. Call preview_action first.');
    const decision = parseConfirmation(confirmation);
    await this.state.audit({ event: 'confirmation_received', interactionId, decision, source, evidenceRef, confirmation });
    if (decision === 'unclear') {
      return { interactionId, status: it.status, decision, signed: this.output.render('I did not understand. Sign YES to confirm or NO to cancel.', { phase: 'preview', interactionId }) };
    }
    if (decision === 'cancel') {
      it.status = 'cancelled';
      it.closedAt = new Date(this.now()).toISOString();
      await this.state.save();
      return { interactionId, status: it.status, decision, signed: this.output.render(`Cancelled. Nothing was done.`, { phase: 'receipt', interactionId }) };
    }
    it.status = 'executed';
    it.closedAt = new Date(this.now()).toISOString();
    it.receipt = { action: it.action, executedAt: it.closedAt, mode: process.env.EXECUTION_MODE ?? 'simulated' };
    await this.state.save();
    await this.state.audit({ event: 'action_executed', interactionId, action: it.action, mode: it.receipt.mode });
    return { interactionId, status: it.status, decision, receipt: it.receipt, signed: this.output.render(`Done: ${it.action}.`, { phase: 'receipt', interactionId, glossText: `${it.action} done` }) };
  }

  async cancelAction({ interactionId }) {
    return this.confirmAction({ interactionId, confirmation: 'cancel' });
  }

  // Cross-session memory: recent interactions plus anything still pending.
  history({ userId = 'default', limit = 10 } = {}) {
    const all = Object.values(this.state.state.interactions)
      .filter((it) => it.userId === userId)
      .map((it) => (it.status === 'awaiting_confirmation' ? this.interaction(it.id) : it))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      userId,
      pending: all.filter((it) => it.status === 'awaiting_confirmation').map(({ id, action, previewedAt }) => ({ id, action, previewedAt })),
      recent: all.slice(0, limit).map(({ id, status, action, intent, source, createdAt }) => ({ id, status, action, text: intent.text, source, createdAt }))
    };
  }

  signedResponse({ text }) {
    return this.output.render(normalizeText(text), { phase: 'response' });
  }
}
