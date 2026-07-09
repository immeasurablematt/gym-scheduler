import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export async function ensureCleanTree({
  cwd,
  execFileImpl = execFile,
  statusOutput,
} = {}) {
  const output =
    statusOutput ??
    (await execFileImpl("git", ["status", "--short"], {
      cwd,
      encoding: "utf8",
    })).stdout;

  if (output.trim().length > 0) {
    throw new Error("Working tree is not clean. Commit or stash changes before bug sweep.");
  }
}

export async function prepareWorktree({
  autoStashDirtyTree = false,
  cwd,
  execFileImpl = execFile,
  now = new Date(),
  statusOutput,
} = {}) {
  const output =
    statusOutput ??
    (await execFileImpl("git", ["status", "--short"], {
      cwd,
      encoding: "utf8",
    })).stdout;

  if (output.trim().length === 0) {
    return {
      notes: ["Working tree was already clean."],
      originalBranch: await getCurrentBranch({ cwd, execFileImpl }),
      stashed: false,
    };
  }

  if (!autoStashDirtyTree) {
    throw new Error("Working tree is not clean. Commit or stash changes before bug sweep.");
  }

  const originalBranch = await getCurrentBranch({ cwd, execFileImpl });
  const stashMessage = `codex overnight bug sweep ${formatStamp({ now })}`;

  await execFileImpl("git", ["stash", "push", "--include-untracked", "-m", stashMessage], {
    cwd,
    encoding: "utf8",
  });

  const stashRef = await findStashRef({ cwd, execFileImpl, stashMessage });

  return {
    notes: ["Dirty worktree was stashed before the sweep."],
    originalBranch,
    stashMessage,
    stashRef,
    stashed: true,
  };
}

export async function restoreWorktree({
  cwd,
  execFileImpl = execFile,
  sweepState,
} = {}) {
  if (!sweepState?.stashed) {
    return {
      notes: sweepState?.notes ?? ["Working tree was already clean."],
      restored: true,
    };
  }

  const notes = [...(sweepState.notes ?? [])];

  try {
    const currentBranch = await getCurrentBranch({ cwd, execFileImpl });

    if (
      sweepState.originalBranch &&
      currentBranch &&
      currentBranch !== sweepState.originalBranch
    ) {
      await execFileImpl("git", ["switch", sweepState.originalBranch], {
        cwd,
        encoding: "utf8",
      });
      notes.push(`Switched back to ${sweepState.originalBranch} before restoring changes.`);
    }

    await execFileImpl("git", ["stash", "apply", sweepState.stashRef], {
      cwd,
      encoding: "utf8",
    });
    await execFileImpl("git", ["stash", "drop", sweepState.stashRef], {
      cwd,
      encoding: "utf8",
    });
    notes.push("Stashed changes were restored cleanly.");

    return {
      notes,
      restored: true,
    };
  } catch (error) {
    notes.push("Restoring stashed changes needs manual review.");

    return {
      notes,
      output: [error?.stdout, error?.stderr, error?.message]
        .filter(Boolean)
        .join("\n")
        .trim(),
      restored: false,
      stashRef: sweepState.stashRef,
    };
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

async function findStashRef({ cwd, execFileImpl, stashMessage }) {
  const { stdout } = await execFileImpl("git", ["stash", "list", "--format=%gd%x09%s"], {
    cwd,
    encoding: "utf8",
  });

  const match = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split("\t"))
    .find(([, message]) => message === stashMessage || message?.endsWith(`: ${stashMessage}`));

  if (!match) {
    throw new Error("Could not locate the bug sweep stash after saving dirty worktree.");
  }

  return match[0];
}

async function getCurrentBranch({ cwd, execFileImpl }) {
  const { stdout } = await execFileImpl("git", ["branch", "--show-current"], {
    cwd,
    encoding: "utf8",
  });

  return stdout.trim();
}

function formatStamp({ now }) {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
