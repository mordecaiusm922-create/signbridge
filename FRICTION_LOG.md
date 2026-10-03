# Friction log

One entry per real problem hit while building. Format follows the hackathon rules.

## Entry 1 — ASL recognition vendor access
- **Task attempted:** Get API access to Sign-Speak's ASL recognition/production APIs (`recognizeASL`, `produceASL`) for the hackathon build.
- **Steps:** Emailed the Sign-Speak team on Sep 11, 2026. Sep 14: the team replied that the independent developer program had a backlog of a couple of months. Sep 30: the CEO replied that API access is focused on enterprise and commercial use cases, with no general developer or free trial tier for hackathon projects, and offered to discuss a possible evaluation if there is a strong fit.
- **Expected:** A sandbox or evaluation key within the 8-week submission window.
- **Actual:** No API access during the first ~5 weeks of the window; a possible evaluation is still under discussion.
- **Severity:** High (blocked the original architecture).
- **Workaround:** On-device MediaPipe landmarks plus a few-shot DTW recognizer for a bounded vocabulary, behind a provider adapter so a vendor API can be plugged in later.
- **Suggestion:** Amazon could pre-arrange hackathon sandbox access with accessibility partners (sign language, captioning) and list them on the Resources page, so accessibility projects are not blocked by enterprise-only access.

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
