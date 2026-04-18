import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const projectRoot = process.cwd();

test("next.config.ts pins the Turbopack root for worktree-safe builds", async () => {
  const source = await readFile(path.join(projectRoot, "next.config.ts"), "utf8");

  assert.match(
    source,
    /turbopack\s*:\s*\{\s*root\s*:/s,
    "expected next.config.ts to set turbopack.root so Next does not infer the wrong lockfile root in a git worktree",
  );
});
