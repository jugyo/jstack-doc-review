import { access, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

const ignoredDirectories = new Set([".git", "node_modules", ".jstack-md"]);

export async function findLatestMarkdown(root) {
  const candidates = [];
  await collectMarkdown(resolve(root), candidates);
  candidates.sort((left, right) => right.createdAt - left.createdAt || left.path.localeCompare(right.path));
  return candidates[0]?.path ?? null;
}

export async function resolveDocument({ explicitPath, cwd = process.cwd(), textFile }) {
  if (explicitPath) return { path: resolve(explicitPath), source: "explicit" };

  const latest = await findLatestMarkdown(cwd);
  if (latest) return { path: latest, source: "latest-markdown" };

  if (textFile) {
    const sourcePath = resolve(textFile);
    let content;
    try {
      content = await readFile(sourcePath, "utf8");
    } catch {
      throw new Error(`Unable to read long text: ${sourcePath}`);
    }
    if (content.trim()) {
      const directory = await mkdtemp(join(tmpdir(), "jstack-md-context-"));
      const path = join(directory, "context.md");
      await writeFile(path, content, { encoding: "utf8", mode: 0o600 });
      return { path, source: "long-text", sourcePath };
    }
  }

  throw new Error("No Markdown review target found. Provide a Markdown path or specify a long text file with --text-file");
}

async function collectMarkdown(directory, candidates) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(entries.map(async entry => {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) await collectMarkdown(join(directory, entry.name), candidates);
      return;
    }
    if (extname(entry.name).toLowerCase() !== ".md") return;
    const path = join(directory, entry.name);
    try {
      await access(path, constants.R_OK | constants.W_OK);
      const details = await stat(path);
      if (details.isFile()) candidates.push({ path, createdAt: details.birthtimeMs || details.ctimeMs || details.mtimeMs });
    } catch {
      // Ignore files that cannot be used as a review document.
    }
  }));
}
