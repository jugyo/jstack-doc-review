#!/usr/bin/env node
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { startServer } from "../src/server.js";

const usage = `jstack-md <document.md> [options]

Options:
  --port <number>       Port (default: an available port)
  --no-open             Do not open the browser
  --data-dir <path>     Data directory (default: ~/.jstack-md)
  --provider <name>     Agent provider name
  --session-id <id>     Authoring agent session id
  --cwd <path>          Agent working directory
  --json                Print only the final review result as JSON
  -h, --help            Show this help`;

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    allowNegative: true,
    options: {
      port: { type: "string" }, open: { type: "boolean", default: true },
      "data-dir": { type: "string" }, provider: { type: "string" },
      "session-id": { type: "string" }, cwd: { type: "string" },
      json: { type: "boolean", default: false }, help: { type: "boolean", short: "h" }
    }
  });
} catch (error) {
  console.error(error.message); console.error(usage); process.exit(2);
}

if (parsed.values.help || parsed.positionals.length !== 1) {
  console.log(usage); process.exit(parsed.values.help ? 0 : 2);
}

const documentPath = resolve(parsed.positionals[0]);
try { await access(documentPath, constants.R_OK | constants.W_OK); }
catch { console.error(`Cannot read and write Markdown file: ${documentPath}`); process.exit(1); }
if (!documentPath.toLowerCase().endsWith(".md")) {
  console.error("jstack-md only reviews .md files"); process.exit(2);
}

const app = await startServer({
  documentPath,
  port: parsed.values.port ? Number(parsed.values.port) : 0,
  openBrowser: parsed.values.open,
  dataDir: parsed.values["data-dir"],
  agentBinding: parsed.values.provider ? {
    provider: parsed.values.provider,
    sessionId: parsed.values["session-id"] ?? null,
    cwd: resolve(parsed.values.cwd ?? process.cwd())
  } : null
});

if (!parsed.values.json) console.error(`Reviewing ${documentPath}\n${app.url}`);
const shutdown = () => app.close().finally(() => process.exit(130));
process.once("SIGINT", shutdown); process.once("SIGTERM", shutdown);
const result = await app.completion;
console.log(JSON.stringify(result, null, 2));
await app.close();
