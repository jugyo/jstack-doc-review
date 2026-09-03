#!/usr/bin/env node
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { startServer } from "../src/server.js";
import { resolveDocument } from "../src/document.js";

const usage = `jstack-doc-review <document.md> [options]

Options:
  --port <number>       Port (default: an available port)
  --no-open             Do not open the browser
  --data-dir <path>     Data directory (default: ~/.jstack-doc-review)
  --text-file <path>    Long text to save as Markdown when no Markdown is found
  --provider <name>     Agent provider name
  --session-id <id>     Authoring agent session ID
  --cwd <path>          Authoring agent working directory
  --json                Output only the final document conversation result as JSON
  -h, --help            Show this help`;

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    allowNegative: true,
    options: {
      port: { type: "string" }, open: { type: "boolean", default: true },
      "data-dir": { type: "string" }, provider: { type: "string" },
      "text-file": { type: "string" },
      "session-id": { type: "string" }, cwd: { type: "string" },
      json: { type: "boolean", default: false }, help: { type: "boolean", short: "h" }
    }
  });
} catch (error) {
  console.error(error.message); console.error(usage); process.exit(2);
}

if (parsed.values.help || parsed.positionals.length > 1) {
  console.log(usage); process.exit(parsed.values.help ? 0 : 2);
}

let document;
try {
  document = await resolveDocument({
    explicitPath: parsed.positionals[0],
    cwd: parsed.values.cwd ?? process.cwd(),
    textFile: parsed.values["text-file"]
  });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const documentPath = document.path;
try {
  await access(documentPath, constants.R_OK | constants.W_OK);
}
catch { console.error(`Unable to read or write Markdown file: ${documentPath}`); process.exit(1); }
if (!documentPath.toLowerCase().endsWith(".md")) {
  console.error("jstack-doc-review only supports .md files"); process.exit(2);
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

if (!parsed.values.json) {
  if (document.source === "latest-markdown") console.error(`Selected latest Markdown: ${documentPath}`);
  if (document.source === "long-text") console.error(`Saved long text as Markdown: ${documentPath}`);
  console.error(`Opened document: ${documentPath}\n${app.url}`);
}
const shutdown = () => app.close().finally(() => process.exit(130));
process.once("SIGINT", shutdown); process.once("SIGTERM", shutdown);
const result = await app.completion;
console.log(JSON.stringify(result, null, 2));
await app.close();
