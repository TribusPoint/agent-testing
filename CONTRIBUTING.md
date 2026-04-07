# Contributing & Local Setup

This guide covers everything you need to clone the repo, get it running locally, and start improving the codebase.

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| **Node.js** | 20+ | LTS recommended — [download](https://nodejs.org/) |
| **npm** | 10+ | Comes with Node.js |
| **Git** | any | [download](https://git-scm.com/) |
| **OpenAI API key** | — | Needed for AI features; entered in the UI Settings page |

Playwright's Chromium browser is installed automatically via `npm run playwright:install`.

---

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/TribusPoint/agent-testing.git
cd agent-testing

# 2. Install dependencies
npm install

# 3. Install Playwright's Chromium
npm run playwright:install

# 4. Start the dev server (auto-reloads on changes)
npm run dev

# 5. Open in your browser
#    http://localhost:3000
```

The dev server uses `tsx watch` so any change to `src/**/*.ts` triggers an automatic restart.

---

## Project Structure

```
.
├── src/
│   ├── index.ts                  # Server entry point
│   ├── server/
│   │   ├── createApp.ts          # Fastify app, routes, WebSocket handlers
│   │   ├── testsStore.ts         # Test data CRUD (JSON file persistence)
│   │   ├── agentsStore.ts        # Agent configuration store
│   │   └── runsStore.ts          # Legacy run store
│   └── browser/
│       ├── aiProvider.ts         # OpenAI provider factory (per-user API keys)
│       ├── siteAnalyzer.ts       # Playwright site scraper + LLM analysis
│       ├── personaGenerator.ts   # Tester persona generation
│       ├── dimensionGenerator.ts # Dimension & personality profile generation
│       ├── questionGenerator.ts  # Multi-round question generation
│       ├── evaluator.ts          # LLM judge for scoring responses
│       ├── inspiredUtterance.ts  # Follow-up message generation
│       ├── supportChatAutonomous.ts  # Autonomous chat session runner
│       └── supportChatSession.ts     # Single-message chat session
├── ui5/                          # Primary UI (sidebar layout)
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── ui4/                          # Alternative tab-based UI
├── ui3/                          # Original UI
├── scripts/                      # Utility scripts
├── choose-ui.html                # UI variant chooser
├── package.json
├── tsconfig.json
├── Dockerfile                    # Production container image
└── .env.example                  # Environment variable template
```

---

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload (`tsx watch`) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server (`node dist/index.js`) |
| `npm run playwright:install` | Install Chromium for Playwright |
| `npm run inspect` | Run the selector inspection utility |

---

## Environment Variables

Copy `.env.example` to `.env` if you want to set server-side defaults:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `OPENAI_API_KEY` | _(empty)_ | Fallback API key (users provide their own via UI) |
| `OPENAI_MODEL` | `gpt-4o-mini` | Default LLM model |

**Note:** The app is designed for users to enter their own API key in the Settings page. A server-side key is optional and serves as a fallback.

---

## How the Codebase Works

### Communication Flow

The frontend (vanilla JS) communicates with the backend entirely through **WebSocket**:

1. On page load, the UI opens a WS connection to `/ws`
2. If the user has an API key saved in `localStorage`, it's sent immediately via `{ type: "set_api_key", apiKey: "sk-..." }`
3. All operations (analyze, generate personas, run tests, etc.) are sent as typed JSON messages
4. The server streams events, transcripts, and results back over the same connection

### Adding a New AI Module

1. Create a new file in `src/browser/`
2. Import `getOpenAI` from `./aiProvider.js` instead of importing `openai` directly
3. Add `apiKey?: string` to your function's options
4. Use `getOpenAI(apiKey)(modelName)` as the model in `generateText()`
5. Wire it up in `src/server/createApp.ts` — add a WS message type and handler
6. Update the UI to send/receive the new message type

### Adding a New UI Section

The ui5 sidebar layout makes it easy to add new sections:

1. Add a `<button class="nav-item">` in the sidebar nav (`ui5/index.html`)
2. Add a `<section id="sec-yourname">` in the main wrap
3. Register the section ID in `sectionIds` array in `ui5/app.js`
4. The `showSection()` function handles visibility toggling automatically

### Data Storage

All data is stored as JSON files in the `data/` directory:

- `data/tests.json` — Tests, personas, questions, dimensions, profiles, runs, reports
- `data/agents.json` — Agent configurations (legacy)
- `data/runs.json` — Run logs (legacy)

The stores auto-save on every mutation. For production deployments, mount `data/` as a persistent volume.

---

## Building for Production

```bash
# Compile TypeScript
npm run build

# Run production server
npm start
```

### Docker

```bash
# Build the image
docker build -t agent-testing .

# Run the container
docker run -p 3000:3000 -v agent-data:/app/data agent-testing
```

The Dockerfile uses the Playwright base image which includes all required system dependencies for Chromium.

---

## Code Style

- TypeScript strict mode is enabled
- ES modules (`"type": "module"` in package.json)
- No linter is configured yet — contributions adding ESLint/Prettier are welcome
- Frontend uses vanilla JS with no build step (edit and refresh)

---

## Ideas for Improvement

- Add ESLint + Prettier configuration
- Implement proper authentication and multi-user support
- Replace JSON file storage with a database (SQLite, PostgreSQL)
- Add test coverage with Vitest
- Build a results dashboard with charts (Chart.js or similar)
- Support additional LLM providers (Anthropic, Google, etc.)
- Add webhook/Slack notifications for completed runs
- Implement scheduled/recurring test runs
- Add support for API-based chatbots (not just web widgets)
