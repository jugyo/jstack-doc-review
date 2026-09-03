import { access, cp, mkdir, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const databaseFiles = name => name === "review.db" || name.startsWith("review.db-");

export async function resolveDataDir({ dataDir, home = homedir() } = {}) {
  if (dataDir) return dataDir;

  const currentDir = join(home, ".jstack-doc-review");
  const legacyDir = join(home, ".jstack-md");
  if (await exists(join(currentDir, "review.db")) || !(await exists(join(legacyDir, "review.db")))) return currentDir;

  await mkdir(currentDir, { recursive: true, mode: 0o700 });
  for (const entry of await readdir(legacyDir, { withFileTypes: true })) {
    if (entry.isFile() && databaseFiles(entry.name)) {
      await cp(join(legacyDir, entry.name), join(currentDir, entry.name), { force: false });
    }
  }
  return currentDir;
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
