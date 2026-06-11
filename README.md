# τ-bench study site

A self-contained static site (no server, no build) explaining τ-bench, a live instance explorer,
and a SABER critical reading.

## Open it
Double-click **`index.html`** (works from `file://`). Pages:
- `index.html` — what τ-bench is / isn't / the problem it poses, the eval mechanism (`r_action × r_output`), τ vs τ², and the four 2025–26 critiques.
- `instances.html` — **scroll all 165 tasks**, see every gold action (mutating vs read), required outputs, and **run a live agent**.
- `saber.html` — SABER ("Small Actions, Big Errors") findings, claim, support, blind spots, overkill?, assumptions.

## Live agent (on the explorer page)
Pick a **retail** task → **▶ Live agent** tab → paste an **Anthropic API key** (stored in your browser's
localStorage; sent only to `api.anthropic.com`). Three modes:
- 🧑 **I'm the customer · LLM is the agent** — you play the τ-bench user; an LLM plays the policy-following agent with a **real in-browser tool backend** (faithful port of the retail tools, operating on the embedded DB).
- 🛠️ **I'm the agent · LLM is the customer** — the LLM user-simulator drives; you respond and may run tools by typing `/call get_order_details {"order_id":"#W..."}`.
- 🤖 **Auto** — both sides are the LLM, like a real τ-bench rollout.

Then **⚖ Grade vs gold**: compares the set of mutating tool calls (name+args) to the gold write-set
(`r_action`) and checks required output substrings (`r_output`). This approximates τ-bench's full-DB-hash reward;
it's exact when gold is the unique write-set.

Notes:
- The faithful tool backend is implemented for **retail**. **Airline** runs the conversation and logs calls for
  grading, but tool results are stubbed (no 5 MB flight DB embedded in this build).
- Browser→Anthropic uses the `anthropic-dangerous-direct-browser-access` header. Your key never goes anywhere else.

## Data
`data/*.js` are generated from `repos/tau-bench` (Sierra) — 165 tasks, 32 tool schemas, the policy wikis, the
user-simulator prompt, and the full retail database (500 users / 1000 orders / 50 products). Regenerate with the
staging script if the upstream repo changes.
