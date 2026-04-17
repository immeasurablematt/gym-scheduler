# Overnight Bug Sweep System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe overnight bug-sweep command that detects available repo checks, creates a fresh branch, auto-fixes only low-risk issues, and writes a plain-English report.

**Architecture:** Use a Node-based runner under `scripts/` so the tool works without an extra compile step. Split the flow into focused modules for repo detection, git safety, low-risk fix execution, and markdown report generation, then expose the runner through `package.json` scripts.

**Tech Stack:** Node.js ESM scripts, `node:test`, npm scripts, git CLI, ESLint, TypeScript, Next.js

---

### Task 1: Add The Command Surface And Lock The Behavior With Tests

**Files:**
- Modify: `package.json`
- Create: `scripts/bug-sweep.test.mjs`
- Create: `scripts/lib/bug-sweep/`

- [ ] **Step 1: Write the failing test for project detection and report generation**

```js
import test from "node:test";
import assert from "node:assert/strict";

import {
  detectProjectChecks,
  formatSweepSummary,
} from "./lib/bug-sweep/index.mjs";

test("detectProjectChecks prefers explicit npm scripts and fallback node tests", () => {
  const checks = detectProjectChecks({
    packageJson: {
      scripts: {
        lint: "eslint",
        build: "next build --turbopack",
      },
    },
    files: ["scripts/dashboard-rendering.test.mjs"],
  });

  assert.deepEqual(checks.map((check) => check.id), [
    "lint",
    "tests",
    "build",
  ]);
});

test("formatSweepSummary renders a morning-friendly markdown report", () => {
  const report = formatSweepSummary({
    branchName: "codex/overnight-bug-sweep-2026-04-17-0200",
    fixes: ["Applied eslint --fix"],
    results: [{ id: "lint", status: "passed" }],
    unresolved: ["Typecheck command missing"],
  });

  assert.match(report, /Overall Result/);
  assert.match(report, /codex\\/overnight-bug-sweep-2026-04-17-0200/);
  assert.match(report, /Typecheck command missing/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/bug-sweep.test.mjs`
Expected: FAIL because `./lib/bug-sweep/index.mjs` does not exist yet

- [ ] **Step 3: Add the npm command surface**

```json
{
  "scripts": {
    "lint": "eslint",
    "typecheck": "tsc --noEmit",
    "test": "node --test scripts/*.test.mjs",
    "check": "npm run lint && npm run typecheck && npm test && npm run build",
    "bug-sweep": "node scripts/bug-sweep.mjs",
    "bug-sweep:dry-run": "node scripts/bug-sweep.mjs --dry-run"
  }
}
```

- [ ] **Step 4: Add the minimal shared exports that make the first tests pass**

```js
export function detectProjectChecks({ packageJson, files }) {
  const checks = [];

  if (packageJson?.scripts?.lint) checks.push({ id: "lint" });
  if (packageJson?.scripts?.typecheck) checks.push({ id: "typecheck" });
  if (packageJson?.scripts?.test) {
    checks.push({ id: "tests" });
  } else if (files.some((file) => file.startsWith("scripts/") && file.endsWith(".test.mjs"))) {
    checks.push({ id: "tests" });
  }
  if (packageJson?.scripts?.build) checks.push({ id: "build" });

  return checks;
}

export function formatSweepSummary({ branchName, fixes, results, unresolved }) {
  return [
    "# Overnight Bug Sweep",
    "",
    "## Overall Result",
    unresolved.length === 0 ? "All discovered checks passed." : "Manual review still needed.",
    "",
    "## Branch Created",
    branchName,
    "",
    "## Fixes Applied",
    fixes.length === 0 ? "- None" : fixes.map((item) => `- ${item}`).join("\n"),
    "",
    "## Still Failing",
    unresolved.length === 0 ? "- None" : unresolved.map((item) => `- ${item}`).join("\n"),
    "",
    "## Checks Run",
    results.map((result) => `- ${result.id}: ${result.status}`).join("\n"),
  ].join("\n");
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test scripts/bug-sweep.test.mjs`
Expected: PASS with 2 tests, 0 failures

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/bug-sweep.test.mjs scripts/lib/bug-sweep/index.mjs
git commit -m "feat: add bug sweep command surface"
```

### Task 2: Implement Detection, Git Safety, And Report Writing

**Files:**
- Create: `scripts/bug-sweep.mjs`
- Create: `scripts/lib/bug-sweep/index.mjs`
- Create: `scripts/lib/bug-sweep/detect.mjs`
- Create: `scripts/lib/bug-sweep/git.mjs`
- Create: `scripts/lib/bug-sweep/report.mjs`
- Modify: `scripts/bug-sweep.test.mjs`

- [ ] **Step 1: Extend the tests to cover dirty-tree refusal and report-path creation**

```js
import path from "node:path";

import {
  ensureCleanTree,
  getReportPath,
} from "./lib/bug-sweep/index.mjs";

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
    path.join("/tmp/example", "reports/bug-sweeps/2026-04-17T020000Z.md"),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/bug-sweep.test.mjs`
Expected: FAIL because `ensureCleanTree` and `getReportPath` do not exist yet

- [ ] **Step 3: Implement focused modules for detection, git safety, and report paths**

```js
export async function ensureCleanTree({ execFile = defaultExecFile, statusOutput } = {}) {
  const output =
    statusOutput ??
    (await execFile("git", ["status", "--short"], { encoding: "utf8" })).stdout;

  if (output.trim().length > 0) {
    throw new Error("Working tree is not clean. Commit or stash changes before bug sweep.");
  }
}

export function getReportPath({ cwd, now = new Date() }) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return new URL(`reports/bug-sweeps/${stamp}.md`, `file://${cwd}/`).pathname;
}
```

- [ ] **Step 4: Wire the main runner with dry-run support**

```js
const dryRun = process.argv.includes("--dry-run");

await ensureCleanTree();
const context = await loadProjectContext({ cwd: process.cwd() });
const checks = detectProjectChecks(context);
const results = await runChecks({ checks, cwd: process.cwd(), dryRun });
const branchName = dryRun ? "dry-run" : await createSweepBranch({ cwd: process.cwd() });
const summary = formatSweepSummary({ branchName, fixes: [], results, unresolved: collectFailures(results) });
await writeReport({ cwd: process.cwd(), summary });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test scripts/bug-sweep.test.mjs`
Expected: PASS with all bug-sweep tests green

- [ ] **Step 6: Commit**

```bash
git add scripts/bug-sweep.mjs scripts/bug-sweep.test.mjs scripts/lib/bug-sweep
git commit -m "feat: add bug sweep detection and reporting"
```

### Task 3: Add Low-Risk Fixing And Re-Verification

**Files:**
- Create: `scripts/lib/bug-sweep/fix.mjs`
- Modify: `scripts/lib/bug-sweep/index.mjs`
- Modify: `scripts/bug-sweep.mjs`
- Modify: `scripts/bug-sweep.test.mjs`

- [ ] **Step 1: Add the failing test for safe fix policy**

```js
import { decideFixPlan } from "./lib/bug-sweep/index.mjs";

test("decideFixPlan only allows eslint auto-fix for low-risk checks", () => {
  const plan = decideFixPlan({
    results: [
      { id: "lint", status: "failed" },
      { id: "build", status: "failed" },
    ],
  });

  assert.deepEqual(plan.allowedFixes, ["lint"]);
  assert.deepEqual(plan.reportOnly, ["build"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/bug-sweep.test.mjs`
Expected: FAIL because `decideFixPlan` does not exist yet

- [ ] **Step 3: Implement the conservative fix policy and re-run affected checks**

```js
export function decideFixPlan({ results }) {
  const allowedFixes = [];
  const reportOnly = [];

  for (const result of results) {
    if (result.status !== "failed") continue;
    if (result.id === "lint") {
      allowedFixes.push("lint");
      continue;
    }

    reportOnly.push(result.id);
  }

  return { allowedFixes, reportOnly };
}

export async function applyAllowedFixes({ allowedFixes, cwd, runCommand }) {
  const fixes = [];

  if (allowedFixes.includes("lint")) {
    await runCommand("npx", ["eslint", ".", "--fix"], { cwd });
    fixes.push("Applied eslint --fix");
  }

  return fixes;
}
```

- [ ] **Step 4: Update the runner to commit only when fixes were applied cleanly**

```js
const fixPlan = decideFixPlan({ results });
const fixes = dryRun ? [] : await applyAllowedFixes({ allowedFixes: fixPlan.allowedFixes, cwd, runCommand });
const rerunResults = fixes.length === 0 ? results : await runChecks({ checks, cwd, ids: fixPlan.allowedFixes });

if (!dryRun && fixes.length > 0) {
  await commitSweepChanges({ cwd, message: "fix: apply overnight bug sweep safe fixes" });
}
```

- [ ] **Step 5: Run focused verification**

Run: `node --test scripts/bug-sweep.test.mjs`
Expected: PASS

Run: `npm run bug-sweep:dry-run`
Expected: PASS and print a report path without creating git changes

- [ ] **Step 6: Commit**

```bash
git add scripts/bug-sweep.mjs scripts/bug-sweep.test.mjs scripts/lib/bug-sweep
git commit -m "feat: add safe bug sweep auto-fixes"
```

### Task 4: Document Overnight Usage And Codify The Repo Workflow

**Files:**
- Modify: `README.md`
- Create: `docs/overnight-bug-sweep.md`

- [ ] **Step 1: Write the failing documentation check in prose**

Document these exact behaviors:
- how to run `npm run bug-sweep:dry-run`
- how to run `npm run bug-sweep`
- where reports are written
- that changes land on a fresh branch and never directly on `main`

- [ ] **Step 2: Add the usage guide**

````md
## Overnight Bug Sweep

Run a dry inspection:

```bash
npm run bug-sweep:dry-run
```

Run the full safe sweep:

```bash
npm run bug-sweep
```

Reports are written under `reports/bug-sweeps/`. Safe fixes are committed onto a fresh `codex/overnight-bug-sweep-*` branch for review.
````

- [ ] **Step 3: Update the README command list**

```md
- `npm run typecheck` - Run TypeScript without emitting files
- `npm test` - Run Node-based script tests
- `npm run check` - Run lint, typecheck, tests, and build
- `npm run bug-sweep:dry-run` - Generate a report without mutating git
- `npm run bug-sweep` - Run the safe overnight bug sweep
```

- [ ] **Step 4: Run final verification**

Run: `npm test`
Expected: PASS

Run: `npm run lint`
Expected: PASS

Run: `npm run typecheck`
Expected: PASS

Run: `npm run build`
Expected: PASS

Run: `npm run bug-sweep:dry-run`
Expected: PASS and create a fresh markdown report under `reports/bug-sweeps/`

- [ ] **Step 5: Commit**

```bash
git add README.md docs/overnight-bug-sweep.md reports/bug-sweeps scripts package.json
git commit -m "docs: add overnight bug sweep usage"
```
