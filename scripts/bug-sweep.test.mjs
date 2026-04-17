import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  decideFixPlan,
  detectProjectChecks,
  ensureCleanTree,
  formatSweepSummary,
  getReportPath,
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

test("ensureCleanTree throws when the repo is dirty", async () => {
  await assert.rejects(
    ensureCleanTree({ statusOutput: " M package.json\n" }),
    /working tree is not clean/i,
  );
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
    missingChecks: ["typecheck"],
    results: [
      { id: "lint", status: "passed" },
      { id: "tests", status: "passed" },
    ],
    unresolved: ["build"],
  });

  assert.match(summary, /Overall Result/);
  assert.match(summary, /Branch Created/);
  assert.match(summary, /Missing Checks/);
  assert.match(summary, /Applied eslint --fix/);
  assert.match(summary, /build/);
});
