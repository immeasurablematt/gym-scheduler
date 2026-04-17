import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export async function ensureCleanTree({ statusOutput } = {}) {
  const output =
    statusOutput ??
    (await execFile("git", ["status", "--short"], {
      encoding: "utf8",
    })).stdout;

  if (output.trim().length > 0) {
    throw new Error("Working tree is not clean. Commit or stash changes before bug sweep.");
  }
}

export function buildSweepBranchName({ now = new Date() } = {}) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `codex/overnight-bug-sweep-${stamp}`;
}

export async function createSweepBranch({ cwd, now = new Date() }) {
  const branchName = buildSweepBranchName({ now });

  await execFile("git", ["switch", "-c", branchName], {
    cwd,
    encoding: "utf8",
  });

  return branchName;
}

export async function hasTrackedChanges({ cwd }) {
  const { stdout } = await execFile("git", ["status", "--short"], {
    cwd,
    encoding: "utf8",
  });

  return stdout.trim().length > 0;
}

export async function commitSweepChanges({ cwd, message }) {
  await execFile("git", ["add", "-A"], { cwd, encoding: "utf8" });
  await execFile("git", ["commit", "-m", message], { cwd, encoding: "utf8" });
}
