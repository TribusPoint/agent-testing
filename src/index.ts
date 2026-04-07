import "dotenv/config";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./server/createApp.js";
import { AgentsStore } from "./server/agentsStore.js";
import { RunsStore } from "./server/runsStore.js";
import { TestsStore } from "./server/testsStore.js";

const root = dirname(fileURLToPath(import.meta.url));
const dataDir = join(root, "..", "data");
mkdirSync(dataDir, { recursive: true });

const agents = new AgentsStore(join(dataDir, "agents.json"));
const runs = new RunsStore(join(dataDir, "runs.json"));
const tests = new TestsStore(join(dataDir, "tests.json"));
const app = await createApp(agents, runs, tests);

const port = Number(process.env.PORT) || 3000;
await app.listen({ port, host: "0.0.0.0" });

app.log.info(`UI5: http://127.0.0.1:${port}/ui5/index.html`);
app.log.info(`UI chooser: http://127.0.0.1:${port}/choose-ui.html`);
