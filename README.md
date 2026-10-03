# SignBridge

**ASL-first, confirm-before-execute bridge for Alexa+.** A Deaf user signs a request; SignBridge recognizes it, shows exactly what will happen in captions and ASL gloss, and executes only after an explicit signed **YES**.

Track: **Alexa+** (self-hosted MCP server, spec `2025-11-25`, Streamable HTTP). Mini-challenge candidate: **AWS Builder** (S3 evidence store, Bedrock intent parsing).

## How the core problem is solved (no vendor API)

Fluent ASL recognition is an open research problem, and no third-party API was available. SignBridge narrows the problem to what the confirm loop needs, a **bounded command vocabulary**, and solves it on-device:

1. **MediaPipe Tasks (browser)** extracts hand (2×21) and pose (33) landmarks per frame. The camera video never leaves the device.
2. Landmarks are normalized (hand shape relative to wrist and hand size; wrist position relative to the shoulders), so signing distance and position do not matter.
3. A **few-shot DTW nearest-neighbour recognizer** learns each sign from ~5 recordings, runs in milliseconds, and **rejects** low-confidence signs ("please sign again") instead of guessing.
4. The recognized gloss (e.g. `RESERVE TABLE FOUR FRIDAY 8pm`) is parsed into an intent (rules, or Amazon Bedrock with `INTENT_MODE=bedrock`).

Output avoids synthetic signing avatars: captions are authoritative, plus an ASL gloss outline and optional **human-recorded clips** for the bounded vocabulary (`public/signs/<GLOSS>.webm`; none are bundled yet, so captions and gloss are shown).

**Honest limits:** this is not fluent ASL translation. It recognizes signs you enroll, one at a time. A larger vocabulary can be added by training a sequence model on the Kaggle *Google – Isolated Sign Language Recognition* dataset (250 signs, same MediaPipe hand/pose landmark topology) behind the same `recognize()` interface.

## Architecture

```
Browser (MediaPipe landmarks) ──> /api/signs/recognize ──> DTW recognizer ──> gloss
                                                                        │
Alexa+ (MCP client) ── Streamable HTTP /mcp ──> SignBridge service ──> state machine
                                                   │                     received → awaiting_confirmation → executed | cancelled | expired
                                                   ├─ data/state.json (survives restarts: cross-session memory)
                                                   ├─ evidence store (local or S3): landmark sequence behind every action
                                                   └─ MCP Apps UI (ui://signbridge/signed-response.html) for Echo Show / Fire TV
```

### MCP tools

| Tool | Purpose |
|---|---|
| `submit_sign_intent` | Register a recognized (or typed) request; returns parsed intent |
| `preview_action` | Show exactly what will happen; nothing executes |
| `confirm_action` | Executes only on an unambiguous YES; any negation cancels; unclear keeps it pending |
| `cancel_action` | Cancel a pending action |
| `get_history` | Pending and recent interactions across sessions |
| `get_signed_response` | Render any Alexa+ reply as captions + gloss + sign clips |

Safety properties (tested): no execution without preview; `"yes, no wait"`, `"ok no"`, `"yes but cancel"` all cancel; pending actions expire after 10 minutes; an action executes at most once.

## Judge quick start (60 seconds, no camera)

```bash
npm install && npm start      # Node.js 20+
```
1. Open http://localhost:3000, expand **Type instead**, enter `RESERVE TABLE FOUR FRIDAY 8pm`, click **Send to Alexa+**.
2. The simulated Alexa+ screen shows the preview and the MCP calls (`submit_sign_intent`, `preview_action`). Nothing has executed.
3. Click **No, cancel** (or send again and click **Yes, do it**) to see the receipt. Typed input is labeled *typed*, never as recognized ASL.
4. Optional: `npx @modelcontextprotocol/inspector` → Streamable HTTP → `http://localhost:3000/mcp`.

Sign recognition needs a webcam, an internet connection (MediaPipe models load from a CDN) and teaching signs first in the **Teach** tab: a fresh install has an empty vocabulary.

## Alexa+ track compliance

The official rules allow two paths for the Alexa+ track; SignBridge implements both.

| Rule | How SignBridge meets it |
|---|---|
| Self-hosted MCP server, spec `2025-11-25`+, Streamable HTTP | `server/index.mjs` + `server/mcp.mjs` use the official `@modelcontextprotocol/sdk` (`StreamableHTTPServerTransport`), protocol `2025-11-25`, sessions, Origin/Host validation |
| Runtime hook (technology invoked in code, not just named) | The MCP SDK is imported and serves `/mcp`; the tools are called at runtime by any MCP client (tested end-to-end in `test/mcp.test.mjs`) |
| Alternative: simulated Alexa+ experience built with an agentic tool, source in repo | `server/alexa-sim.mjs`: an Alexa+ host that is a real MCP client of `/mcp`. `SIM_AGENT=bedrock` lets Amazon Bedrock (Converse tool use) choose the MCP tools; `SIM_AGENT=scripted` is a deterministic offline fallback. The companion app shows its screen (MCP Apps view) and every `tools/call` |
| "Creative" signals from the judging guide | Agentic flow across tools; context kept across sessions (`get_history`, persistence); MCP Apps UI for screen devices |

## Measuring recognition (Evaluate tab)

Pick what you are about to sign (or *not a sign*), sign it, repeat. The tab computes accuracy, rejection and confusion rates, a confusion matrix, the number of attempts that **would have executed as YES without being YES** (target: 0), and a recommended `RECOGNIZER_REJECT_DISTANCE` from the observed distances. Export as CSV. Confirmations use a stricter, asymmetric policy: YES must be closer and clearly separated from the runner-up (`CONFIRM_REJECT_DISTANCE`, `CONFIRM_MIN_MARGIN`); NO only needs the normal threshold, because cancelling by mistake is cheap.

## Run

Requires Node.js 20+ and a webcam (Chrome/Edge).

```bash
npm install
cp .env.example .env   # optional
npm start
```

- Companion app: http://localhost:3000
- MCP endpoint: http://localhost:3000/mcp

**Demo flow:** Start camera → teach `YES`, `NO`, `RESERVE`, `TABLE`, `FOUR`, `FRIDAY` (~5 recordings each, hold the button while signing) → switch to *request* mode and sign → *Send* → sign `YES` in confirmation mode → receipt.

**Connect to Alexa+:** expose `/mcp` over HTTPS (e.g. a tunnel), add the tunnel host to `ALLOWED_HOSTS`/`ALLOWED_ORIGINS`, and register the URL following the Alexa+ MCP documentation. You can also inspect it with `npx @modelcontextprotocol/inspector`.

## Test

```bash
npm test
```

17 tests. Covers strict confirmation, the asymmetric YES policy, evaluation metrics, the simulated Alexa+ host driving the loop over MCP, intent parsing, recognizer accuracy and rejection, persistence across restart, expiry, and an end-to-end MCP client session over Streamable HTTP (including Origin rejection).

## AWS

- `STORAGE_MODE=s3` + `S3_BUCKET`: landmark evidence for every recognized sign is stored in S3 (SSE enabled).
- `INTENT_MODE=bedrock` + `BEDROCK_MODEL_ID`: Amazon Bedrock Converse API turns terse ASL gloss into a structured action; falls back to rules on any error.

## License

MIT © Jonny Yazid Salazar Hernandez. Third-party components: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
