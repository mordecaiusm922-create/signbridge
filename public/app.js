// SignBridge companion app: MediaPipe landmarks in the browser -> SignBridge API.
import { summarize, toCSV, NOT_A_SIGN } from './evaluation.mjs';
import { FilesetResolver, HandLandmarker, PoseLandmarker, DrawingUtils } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...children) => { const n = Object.assign(document.createElement(tag), props); n.append(...children); return n; };
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const POSE_MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const SUGGESTED = ['YES', 'NO', 'HELP', 'RESERVE', 'TABLE', 'FOUR', 'FRIDAY', 'BUY', 'CALL'];
const TARGET_EXAMPLES = 5;

const state = { mode: 'ask', recording: false, frames: [], tokens: [], pendingTtl: 600000, vocabulary: {}, timer: null, sessionId: crypto.randomUUID(), evalTarget: null, trials: loadTrials() };

function loadTrials() { try { return JSON.parse(localStorage.getItem('signbridge.trials') ?? '[]'); } catch { return []; } }
function saveTrials() { try { localStorage.setItem('signbridge.trials', JSON.stringify(state.trials)); } catch { /* storage unavailable */ } }

const api = async (url, body) => {
  const r = await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? 'Request failed');
  return data;
};
const say = (text, tone = '') => { $('#camStatus').textContent = text; $('#camStatus').dataset.tone = tone; };
const toXYZ = (lms) => lms.map((p) => [p.x, p.y, p.z]);
const awaitingConfirmation = () => !$('#confirmBox').hidden;

// ---- Tabs ---------------------------------------------------------------
const TABS = { ask: ['#tabAsk', '#viewAsk'], teach: ['#tabTeach', '#viewTeach'], evaluate: ['#tabEval', '#viewEval'] };
function setMode(mode) {
  state.mode = mode;
  for (const [m, [tab, view]] of Object.entries(TABS)) {
    $(tab).setAttribute('aria-selected', m === mode);
    $(view).hidden = m !== mode;
  }
  $('#recLabel').textContent = mode === 'teach' ? `Hold to record “${currentGloss() || '…'}”`
    : mode === 'evaluate' ? (state.evalTarget ? `Hold to test “${state.evalTarget}”` : 'Pick a target first') : 'Hold to sign';
  if (mode === 'evaluate') renderEval();
}
$('#tabAsk').onclick = () => setMode('ask');
$('#tabTeach').onclick = () => setMode('teach');
$('#tabEval').onclick = () => setMode('evaluate');

// ---- Teach --------------------------------------------------------------
const currentGloss = () => $('#gloss').value.trim().toUpperCase();
function renderSuggest() {
  $('#suggest').replaceChildren(...SUGGESTED.map((g) => {
    const b = el('button', { className: 'chip', type: 'button', textContent: g });
    b.setAttribute('aria-pressed', g === currentGloss());
    b.onclick = () => { $('#gloss').value = g; renderSuggest(); setMode('teach'); };
    return b;
  }));
}
$('#gloss').oninput = () => { renderSuggest(); setMode('teach'); };

function renderVocab() {
  const entries = Object.entries(state.vocabulary);
  $('#vocabCount').textContent = entries.length;
  $('#vocab').replaceChildren(...(entries.length ? entries.map(([g, n]) => {
    const meter = el('span', { className: 'meter', title: `${n} examples` }, ...Array.from({ length: TARGET_EXAMPLES }, (_, i) => el('i', { className: i < n ? 'on' : '' })));
    return el('li', {}, el('span', { textContent: g }), meter, el('small', { textContent: n >= TARGET_EXAMPLES ? 'ready' : `${n}/${TARGET_EXAMPLES}` }));
  }) : [el('li', {}, el('small', { textContent: 'No signs taught yet. Start with YES and NO.' }))]));
}

// ---- Ask ----------------------------------------------------------------
function renderTokens() {
  const box = $('#tokens');
  box.replaceChildren(...(state.tokens.length
    ? state.tokens.map((t) => el('span', { className: 'token' }, t.gloss, el('small', { textContent: `${Math.round(t.confidence * 100)}% sure` })))
    : [el('span', { className: 'placeholder', textContent: 'Signs you make appear here' })]));
  $('#send').disabled = !state.tokens.length && !$('#typed').value.trim();
}
$('#typed').oninput = renderTokens;
$('#clear').onclick = () => { state.tokens = []; $('#typed').value = ''; renderTokens(); };

function show(res) {
  const s = res.signed;
  const card = $('#result');
  card.hidden = false;
  card.dataset.phase = s.phase;
  card.dataset.status = res.status ?? res.interaction?.status ?? '';
  $('#phase').textContent = { intent: 'Understood', preview: 'Please confirm', receipt: res.status === 'cancelled' ? 'Cancelled' : 'Done', response: 'Response' }[s.phase] ?? s.phase;
  $('#captions').textContent = s.phase === 'preview' && res.action ? `${res.action}?` : s.captions;
  $('#glossOut').replaceChildren(...s.gloss.map((g) => el('span', { textContent: g })));
  $('#clips').replaceChildren(...s.clips.filter((c) => c.url).map((c) =>
    el('figure', {}, el('video', { src: c.url, autoplay: true, muted: true, loop: true, playsInline: true }), el('figcaption', { textContent: c.gloss }))));
  const waiting = res.status === 'awaiting_confirmation';
  $('#confirmBox').hidden = !waiting;
  clearInterval(state.timer);
  if (waiting) {
    const start = Date.now();
    state.timer = setInterval(() => {
      const left = Math.max(0, 1 - (Date.now() - start) / state.pendingTtl);
      $('#timerBar').style.transform = `scaleX(${left})`;
      if (!left) clearInterval(state.timer);
    }, 1000);
    $('#yes').focus({ preventScroll: true });
  }
  refresh();
}

// Every request goes to the (simulated) Alexa+ host, which calls SignBridge
// through MCP — the same path a real Alexa+ device would take.
async function alexa(utterance, source) {
  $('#echoRing').dataset.on = '';
  $('#echoReply').textContent = 'Thinking…';
  try {
    const r = await api('/api/alexa/turn', { sessionId: state.sessionId, utterance, source });
    $('#echoReply').textContent = r.reply;
    $('#echoAgent').textContent = `agent: ${r.agent}`;
    $('#traceCount').textContent = r.trace.length;
    $('#trace').replaceChildren(...r.trace.map((t) => el('li', { className: t.isError ? 'err' : '' },
      el('code', { textContent: `tools/call ${t.tool}` }), ` ${t.isError ? '→ error' : ''}`)));
    if (r.ui) {
      $('#echoView').contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: r.ui } }, location.origin);
      show({ ...r.ui, status: r.ui.status ?? r.ui.interaction?.status });
    }
  } catch (e) { $('#echoReply').textContent = e.message; say(e.message, 'warn'); }
  finally { delete $('#echoRing').dataset.on; }
}

async function send() {
  const typed = $('#typed').value.trim();
  const text = state.tokens.length ? state.tokens.map((t) => t.gloss).join(' ') : typed;
  if (!text) return;
  const source = state.tokens.length ? 'asl' : 'typed';
  state.tokens = []; $('#typed').value = ''; renderTokens();
  await alexa(text, source);
}
$('#send').onclick = send;

const confirm = (text, source = 'typed') => alexa(text, source);
$('#yes').onclick = () => confirm('YES');
$('#no').onclick = () => confirm('NO');

// ---- Evaluate -----------------------------------------------------------
const pct = (x) => (x === null ? '–' : `${Math.round(x * 100)}%`);
function renderEvalTargets() {
  const targets = [...new Set([...Object.keys(state.vocabulary), ...state.trials.map((t) => t.target).filter((g) => g !== NOT_A_SIGN)]), NOT_A_SIGN];
  $('#evalTargets').replaceChildren(...targets.map((g) => {
    const b = el('button', { className: 'chip', type: 'button', textContent: g });
    b.setAttribute('aria-pressed', g === state.evalTarget);
    b.onclick = () => { state.evalTarget = g; renderEvalTargets(); setMode('evaluate'); };
    return b;
  }));
}
function renderEval() {
  const r = summarize(state.trials);
  const stat = (value, label, tone = '') => el('div', { className: `stat ${tone}` }, el('b', { textContent: value }), el('span', { textContent: label }));
  $('#evalStats').replaceChildren(
    stat(r.trials, 'trials'),
    stat(pct(r.accuracy), 'correct', r.accuracy >= 0.9 ? 'good' : ''),
    stat(pct(r.rejectionRate), 'asked to repeat'),
    stat(pct(r.confusionRate), 'confused', r.confusionRate > 0 ? 'bad' : ''),
    stat(`${r.falseYes}/${r.nonYesTrials}`, 'would falsely execute', r.falseYes ? 'bad' : r.nonYesTrials ? 'good' : ''));
  const verdict = $('#evalVerdict');
  if (!r.trials) verdict.textContent = 'No trials yet. Aim for 10 per sign plus 10 non-signs.';
  else if (r.falseYes) verdict.textContent = `Unsafe: ${r.falseYes} attempt(s) that were not YES would have executed. Record more YES examples or lower CONFIRM_REJECT_DISTANCE.`;
  else if (r.threshold) verdict.replaceChildren(r.threshold.separable ? 'Signs and impostors are separable. Recommended: ' : 'Distances overlap; this setting blocks all impostors: ', el('code', { textContent: `RECOGNIZER_REJECT_DISTANCE=${r.threshold.value}` }), ` (keeps ${pct(r.threshold.keepsGenuine)} of correct signs).`);
  else verdict.textContent = 'Add both real signs and non-signs to get a threshold recommendation.';
  const table = $('#evalTable');
  const rows = Object.entries(r.confusion);
  table.replaceChildren(...(rows.length ? [
    el('caption', { textContent: 'Rows: what you signed · Columns: what was recognized' }),
    el('tr', {}, el('th', { textContent: '' }), ...r.columns.map((c) => el('th', { scope: 'col', textContent: c }))),
    ...rows.map(([target, counts]) => el('tr', {}, el('th', { scope: 'row', textContent: target }), ...r.columns.map((c) => {
      const n = counts[c] ?? 0;
      const hit = c === target || (target === NOT_A_SIGN && c === '(rejected)');
      return el('td', { className: n ? (hit ? 'hit' : 'miss') : '', textContent: n || '·' });
    })))] : []));
  const d = r.distances;
  $('#evalDistances').textContent = r.trials ? `Distances — correct signs: ${d.genuine.min ?? '–'} to ${d.genuine.max ?? '–'} · impostors: ${d.impostor.min ?? '–'} to ${d.impostor.max ?? '–'}` : '';
}
$('#evalUndo').onclick = () => { state.trials.pop(); saveTrials(); renderEval(); };
$('#evalReset').onclick = () => { if (confirm_('Delete all evaluation trials?')) { state.trials = []; saveTrials(); renderEval(); } };
$('#evalExport').onclick = () => {
  const url = URL.createObjectURL(new Blob([toCSV(state.trials)], { type: 'text/csv' }));
  el('a', { href: url, download: 'signbridge-evaluation.csv' }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const confirm_ = (msg) => window.confirm(msg);

// ---- Memory -------------------------------------------------------------
const LABEL = { executed: 'Done', cancelled: 'Cancelled', expired: 'Expired', awaiting_confirmation: 'Waiting', received: 'Noted' };
function renderHistory(h) {
  const items = h.recent.map((it) => el('li', {},
    el('span', { className: `tag ${it.status}`, textContent: LABEL[it.status] ?? it.status }),
    el('span', { textContent: it.action ?? it.text }),
    el('small', { textContent: `${it.source === 'asl' ? 'Signed' : 'Typed'} · ${new Date(it.createdAt).toLocaleString()}` })));
  $('#history').replaceChildren(...(items.length ? items : [el('li', {}, el('span', { className: 'empty', textContent: 'Nothing yet. Past requests are kept across sessions.' }))]));
}

async function refresh() {
  try {
    const h = await api('/health');
    state.vocabulary = h.vocabulary; state.pendingTtl = h.pendingTtlMs ?? state.pendingTtl;
    $('#echoAgent').textContent ||= `agent: ${h.simAgent}`;
    renderVocab(); renderEvalTargets();
    renderHistory(await api('/api/history'));
  } catch { say('Cannot reach the SignBridge server.', 'warn'); }
}

// ---- Camera + recording -------------------------------------------------
let hands; let pose;
$('#startCam').onclick = async () => {
  const stage = $('#stage');
  $('#startCam').disabled = true;
  say('Loading hand and pose models…');
  try {
    const vision = await FilesetResolver.forVisionTasks(WASM);
    hands = await HandLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'GPU' }, runningMode: 'VIDEO', numHands: 2 });
    pose = await PoseLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: POSE_MODEL, delegate: 'GPU' }, runningMode: 'VIDEO' });
    const video = $('#cam');
    video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
    await video.play();
  } catch (e) {
    $('#startCam').disabled = false;
    return say(`Camera unavailable: ${e.message}`, 'warn');
  }
  const video = $('#cam');
  const canvas = $('#overlay');
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  const draw = new DrawingUtils(ctx);
  stage.dataset.state = 'ready';
  $('#pillCam').classList.add('on'); $('#pillCam').lastChild.textContent = 'Camera on';
  $('#rec').disabled = false;
  say(Object.keys(state.vocabulary).length ? 'Ready. Hold the button (or Space) while you sign.' : 'Ready. Start by teaching YES and NO.', 'ok');
  if (!Object.keys(state.vocabulary).length) setMode('teach');
  let last = -1;
  const loop = () => {
    if (video.currentTime !== last) {
      last = video.currentTime;
      const t = performance.now();
      const h = hands.detectForVideo(video, t);
      const p = pose.detectForVideo(video, t);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const color = state.recording ? '#ff4d40' : '#5fc2b8';
      for (const lm of h.landmarks) {
        draw.drawConnectors(lm, HandLandmarker.HAND_CONNECTIONS, { color, lineWidth: 3 });
        draw.drawLandmarks(lm, { color: '#ffffff', radius: 2 });
      }
      if (state.recording) {
        const frame = { leftHand: null, rightHand: null, pose: p.landmarks[0] ? toXYZ(p.landmarks[0]) : null };
        h.handedness.forEach((cat, i) => { frame[cat[0].categoryName === 'Left' ? 'leftHand' : 'rightHand'] = toXYZ(h.landmarks[i]); });
        state.frames.push(frame);
      }
    }
    requestAnimationFrame(loop);
  };
  loop();
};

function startRec() {
  if ($('#rec').disabled || state.recording) return;
  state.frames = []; state.recording = true;
  $('#stage').dataset.state = 'recording';
  $('#rec').setAttribute('aria-pressed', 'true');
  say('Signing…');
}
async function stopRec() {
  if (!state.recording) return;
  state.recording = false;
  $('#stage').dataset.state = 'ready';
  $('#rec').setAttribute('aria-pressed', 'false');
  const frames = state.frames;
  try {
    if (state.mode === 'teach') {
      const r = await api('/api/signs/enroll', { gloss: currentGloss(), frames });
      const n = r.vocabulary[r.gloss];
      say(n >= TARGET_EXAMPLES ? `${r.gloss} is ready. Teach the next sign.` : `Saved example ${n} of ${TARGET_EXAMPLES} for ${r.gloss}.`, 'ok');
      return refresh();
    }
    if (state.mode === 'evaluate') {
      if (!state.evalTarget) return say('Pick what you are about to sign first.', 'warn');
      const r = await api('/api/signs/evaluate', { frames });
      state.trials.push({ target: state.evalTarget, predicted: r.gloss, confirmGloss: r.confirmGloss, best: r.best, at: new Date().toISOString() });
      saveTrials(); renderEval();
      const ok = state.evalTarget === NOT_A_SIGN ? !r.gloss : r.gloss === state.evalTarget;
      return say(`${ok ? '✓' : '✗'} Target ${state.evalTarget} → ${r.gloss ?? 'rejected'} (distance ${r.best.distance}).`, ok ? 'ok' : 'warn');
    }
    if (awaitingConfirmation()) {
      const r = await api('/api/signs/confirm', { frames });
      if (!r.gloss) return say(r.reason, 'warn');
      say(`Recognized ${r.gloss}.`, 'ok');
      return confirm(r.gloss, 'asl');
    }
    const r = await api('/api/signs/recognize', { frames });
    if (!r.gloss) return say('I’m not sure what that sign was. Please sign it again.', 'warn');
    state.tokens.push(r);
    renderTokens();
    say(`Recognized ${r.gloss}.`, 'ok');
  } catch (e) { say(e.message, 'warn'); }
}
$('#rec').addEventListener('pointerdown', (e) => { $('#rec').setPointerCapture(e.pointerId); startRec(); });
$('#rec').addEventListener('pointerup', stopRec);
$('#rec').addEventListener('pointercancel', stopRec);
const typing = () => ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !e.repeat && !typing()) { e.preventDefault(); startRec(); } });
window.addEventListener('keyup', (e) => { if (e.code === 'Space' && !typing()) { e.preventDefault(); stopRec(); } });

renderSuggest(); renderTokens(); setMode('ask'); refresh();
