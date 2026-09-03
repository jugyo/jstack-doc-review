import { homedir } from "node:os";
import { join } from "node:path";

export async function resolveDataDir({ dataDir, home = homedir() } = {}) {
  if (dataDir) return dataDir;
  return join(home, ".jstack-doc-review");
}
