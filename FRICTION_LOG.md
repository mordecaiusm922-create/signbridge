# Friction log

One entry per real problem hit while building. Format follows the hackathon rules.

## Entry 1 — ASL recognition API access
- **Task attempted:** Integrate Sign-Speak's ASL recognition and production APIs (`recognizeASL`, `produceASL`) as the recognition backend.
- **Steps:** Contacted Sign-Speak on Sep 11, 2026. Sep 14: their team kindly replied that the independent developer program had a waitlist of a couple of months. Sep 30: Sign-Speak's co-founder replied personally, explaining that API access currently focuses on enterprise and commercial use cases, with no free or hackathon tier, and offered to learn more about the project to see whether an evaluation could fit. That conversation is ongoing.
- **Expected:** Sandbox access within the submission window.
- **Actual:** No API access available during the window so far.
- **Severity:** High (it changed the original architecture).
- **Workaround:** On-device MediaPipe landmarks plus a few-shot DTW recognizer for a bounded vocabulary, behind a provider adapter, so a professional API like Sign-Speak's can be plugged in later.
- **Suggestion:** Amazon could pre-arrange hackathon sandbox access with accessibility partners (sign language, captioning) and list them on the Resources page. Thanks to the Sign-Speak team for taking the time to respond personally.


## Entry 2 — Alexa+ developer access
- **Task attempted:** Test the MCP server against a real Alexa+ host.
- **Steps:** _fill in what you tried (account, region, device)_
- **Expected:** _…_
- **Actual:** _…_
- **Severity:** _…_
- **Workaround:** Simulated Alexa+ host (`server/alexa-sim.mjs`) as a real MCP client + MCP Inspector.
- **Suggestion:** _e.g. a hosted Alexa+ MCP test console usable from any region._

## Entry template
- **Task attempted:**
- **Steps:**
- **Expected:**
- **Actual:**
- **Severity:** Critical / High / Medium / Low
- **Workaround:**
- **Suggestion:**
