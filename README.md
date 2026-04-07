# Agent Testing Framework

An end-to-end platform for testing AI-powered chatbots and support agents. Point it at any website with a chat widget, and the framework will **analyze the site**, **generate realistic tester personas**, **create diverse test questions**, **run automated conversations** through the real chat UI via Playwright, and **evaluate the responses** using an LLM judge.

---

## How It Works

```
┌──────────┐      WebSocket / REST       ┌──────────────┐
│  Browser  │  ◄────────────────────────► │  Node Server  │
│  (UI5)    │                             │  (Fastify)    │
└──────────┘                              └──────┬───────┘
                                                 │
                              ┌───────────┬──────┴──────┬────────────┐
                              ▼           ▼             ▼            ▼
                        Site Analyzer  Persona Gen  Question Gen  Evaluator
                        (Playwright)   (OpenAI)     (OpenAI)      (OpenAI)
```

### 1. Create a Test

Provide the URL of the site you want to test. The framework uses Playwright to launch a headless browser, scrape the site's content (services, audience, navigation, keywords), and sends it to an LLM for a structured **site analysis**.

### 2. Generate Testers, Dimensions & Questions

- **Testers (Personas)**: The LLM generates diverse user profiles — each with a name, background, personality, knowledge level, and goal — tailored to the site's domain.
- **Dimensions**: Test axes like complexity, intent, topic area, and urgency are auto-generated based on the site analysis.
- **Personality Profiles**: Communication styles (polite, frustrated, confused, technical, etc.) that shape how each question is asked.
- **Questions**: The LLM produces a configurable number of test questions. Each question is tagged with a tester, dimension value, and personality profile to ensure broad coverage.

### 3. Run Tests

**Automated Runs** — The framework opens the real chat widget via Playwright, sends each question as a real user would, waits for the bot's reply, and optionally sends follow-up messages (using "inspired utterance" generation) when the answer is incomplete. Every response is scored (0–100) by an LLM evaluator.

**Manual Chat** — Connect to the live chat widget through the UI and interact manually. Transcripts are saved for review.

### 4. Score & Report

- Per-question scores, latency, follow-up counts, and evaluator notes
- Aggregate score cards (average, min, max, median)
- Score distribution charts
- Run-over-run comparison (pick any two runs, see per-question deltas)
- CSV export
- Human override: manually adjust scores and add notes

---

## Architecture

| Layer | Tech | Purpose |
|-------|------|---------|
| **Frontend** | Vanilla JS, CSS Variables | Three UI variants (ui3, ui4, ui5); ui5 is the primary sidebar layout |
| **Server** | Node.js, Fastify, WebSocket | REST API + real-time WS for long-running operations |
| **AI** | OpenAI via Vercel AI SDK | Site analysis, persona/question generation, utterance generation, evaluation |
| **Browser Automation** | Playwright (Chromium) | Site scraping, chat widget interaction |
| **Storage** | JSON files in `data/` | Tests, runs, agents — persisted to disk |

### Key Backend Modules

| File | Role |
|------|------|
| `src/server/createApp.ts` | Fastify app factory — routes, WS handlers, orchestration |
| `src/server/testsStore.ts` | Test CRUD, persona/question/run persistence |
| `src/browser/siteAnalyzer.ts` | Playwright + LLM site scraping and analysis |
| `src/browser/personaGenerator.ts` | LLM-powered tester persona generation |
| `src/browser/questionGenerator.ts` | Multi-round LLM question generation with diversity |
| `src/browser/dimensionGenerator.ts` | Test dimension and personality profile generation |
| `src/browser/evaluator.ts` | LLM judge for scoring chatbot responses |
| `src/browser/inspiredUtterance.ts` | Follow-up message generation when answers are incomplete |
| `src/browser/supportChatAutonomous.ts` | Autonomous multi-turn chat session runner |
| `src/browser/aiProvider.ts` | OpenAI provider helper — supports per-user API keys |

### User-Provided API Key

The app does **not** require a server-side `OPENAI_API_KEY`. Instead, users enter their own key in **Settings**. The key is stored in the browser's `localStorage` and sent to the server over WebSocket on each connection. All AI operations use the per-connection key.

### Dark / Light Mode

A toggle in the sidebar footer switches between dark and light themes. The preference is persisted in `localStorage`.

---

## UI Variants

| Variant | Path | Description |
|---------|------|-------------|
| **ui5** (primary) | `/ui5/` | Sidebar navigation — Dashboard, Tests, Runs, Scoring, Settings |
| ui4 | `/ui4/` | Tab-based layout |
| ui3 | `/ui3/` | Original tab layout |

The root URL (`/`) redirects to ui5. A chooser page at `/choose-ui.html` lets you switch between variants.

---

## Deployment (Railway)

The included `Dockerfile` builds a production image with Playwright's Chromium dependencies.

1. Push this repo to GitHub
2. Create a new Railway project and connect the repo
3. Railway auto-detects the Dockerfile
4. Add a **persistent volume** mounted at `/app/data` to keep test data across deploys
5. No environment variables are required — users provide their own OpenAI key via the UI

The server listens on `PORT` (defaults to 3000), which Railway sets automatically.
