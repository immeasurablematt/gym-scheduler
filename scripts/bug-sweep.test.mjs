import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  decideFixPlan,
  detectProjectChecks,
  formatSweepSummary,
  getReportPath,
  prepareWorktree,
  restoreWorktree,
} from "./lib/bug-sweep/index.mjs";

test("detectProjectChecks prefers explicit npm scripts and fallback script tests", () => {
  const checks = detectProjectChecks({
    packageJson: {
      scripts: {
        lint: "eslint",
        build: "next build --turbopack",
      },
    },
    files: ["scripts/dashboard-rendering.test.mjs"],
  });

  assert.deepEqual(checks.map((check) => check.id), ["lint", "tests", "build"]);
});

test("prepareWorktree throws when the repo is dirty and auto-stash is disabled", async () => {
  await assert.rejects(
    prepareWorktree({ autoStashDirtyTree: false, statusOutput: " M package.json\n" }),
    /working tree is not clean/i,
  );
});

test("prepareWorktree stashes a dirty tree when auto-stash is enabled", async () => {
  const calls = [];
  const execFileImpl = async (command, args) => {
    calls.push([command, args]);

    if (args.join(" ") === "branch --show-current") {
      return { stdout: "main\n", stderr: "" };
    }

    if (args.join(" ") === "stash push --include-untracked -m codex overnight bug sweep 20260417T020000Z") {
      return { stdout: "Saved\n", stderr: "" };
    }

    if (args.join(" ") === "stash list --format=%gd%x09%s") {
      return {
        stdout: "stash@{0}\tOn main: codex overnight bug sweep 20260417T020000Z\n",
        stderr: "",
      };
    }

    throw new Error(`Unexpected git args: ${args.join(" ")}`);
  };

  const result = await prepareWorktree({
    autoStashDirtyTree: true,
    cwd: "/tmp/example",
    execFileImpl,
    now: new Date("2026-04-17T02:00:00Z"),
    statusOutput: " M package.json\n?? scratch.txt\n",
  });

  assert.equal(result.stashed, true);
  assert.equal(result.originalBranch, "main");
  assert.equal(result.stashRef, "stash@{0}");
  assert.match(result.notes.join("\n"), /stashed before the sweep/i);
  assert.deepEqual(calls, [
    ["git", ["branch", "--show-current"]],
    ["git", ["stash", "push", "--include-untracked", "-m", "codex overnight bug sweep 20260417T020000Z"]],
    ["git", ["stash", "list", "--format=%gd%x09%s"]],
  ]);
});

test("restoreWorktree switches back and restores the saved stash", async () => {
  const calls = [];
  const execFileImpl = async (command, args) => {
    calls.push([command, args]);

    if (args.join(" ") === "branch --show-current") {
      return { stdout: "codex/overnight-bug-sweep-20260417T020000Z\n", stderr: "" };
    }

    if (args.join(" ") === "switch main") {
      return { stdout: "", stderr: "" };
    }

    if (args.join(" ") === "stash apply stash@{0}") {
      return { stdout: "", stderr: "" };
    }

    if (args.join(" ") === "stash drop stash@{0}") {
      return { stdout: "", stderr: "" };
    }

    throw new Error(`Unexpected git args: ${args.join(" ")}`);
  };

  const result = await restoreWorktree({
    cwd: "/tmp/example",
    execFileImpl,
    sweepState: {
      notes: ["Dirty worktree was stashed before the sweep."],
      originalBranch: "main",
      stashRef: "stash@{0}",
      stashed: true,
    },
  });

  assert.equal(result.restored, true);
  assert.match(result.notes.join("\n"), /switched back to main/i);
  assert.match(result.notes.join("\n"), /restored cleanly/i);
  assert.deepEqual(calls, [
    ["git", ["branch", "--show-current"]],
    ["git", ["switch", "main"]],
    ["git", ["stash", "apply", "stash@{0}"]],
    ["git", ["stash", "drop", "stash@{0}"]],
  ]);
});

test("getReportPath writes into reports/bug-sweeps with a timestamped filename", () => {
  const reportPath = getReportPath({
    cwd: "/tmp/example",
    now: new Date("2026-04-17T02:00:00Z"),
  });

  assert.equal(
    reportPath,
    path.join("/tmp/example", "reports/bug-sweeps/20260417T020000Z.md"),
  );
});

test("decideFixPlan only allows lint auto-fixes for failed low-risk checks", () => {
  const plan = decideFixPlan({
    results: [
      { id: "lint", status: "failed" },
      { id: "build", status: "failed" },
      { id: "tests", status: "passed" },
    ],
  });

  assert.deepEqual(plan.allowedFixes, ["lint"]);
  assert.deepEqual(plan.reportOnly, ["build"]);
});

test("formatSweepSummary renders a plain-English morning report", () => {
  const summary = formatSweepSummary({
    branchName: "codex/overnight-bug-sweep-20260417T020000Z",
    fixes: ["Applied eslint --fix"],
    manualReviewNeeded: true,
    missingChecks: ["typecheck"],
    results: [
      { id: "lint", status: "passed" },
      { id: "tests", status: "passed" },
    ],
    unresolved: ["build"],
    worktreeNotes: ["Dirty worktree was stashed before the sweep."],
  });

  assert.match(summary, /Overall Result/);
  assert.match(summary, /Worktree Handling/);
  assert.match(summary, /Branch Created/);
  assert.match(summary, /Missing Checks/);
  assert.match(summary, /Applied eslint --fix/);
  assert.match(summary, /build/);
});
