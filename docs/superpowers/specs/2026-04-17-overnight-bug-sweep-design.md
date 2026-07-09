# Overnight Bug Sweep Design

## Summary

This design adds a safe, repeatable overnight bug-sweep workflow that can be pointed at this repo now and reused in future repos with minimal per-project setup.

The system should gather reliable signals first, fix only low-risk issues automatically, never write to `main`, and leave a plain-English report that a non-developer can scan in the morning.

## Goals

- Provide one command that scans the repo for common breakage.
- Support unattended overnight runs.
- Auto-fix only low-risk issues on a fresh branch.
- Re-run checks after any fix attempt.
- Produce a readable report that explains what happened.
- Keep the core flow portable across other Node-based codebases.

## Non-Goals

- Fully autonomous refactoring across arbitrary languages.
- Silent changes to production logic, auth, payments, scheduling, or database schema.
- Automatic merges into `main`.
- A perfect universal fixer for every repo shape.

## Recommended Approach

Use a repo-local bug-sweep runner plus a thread automation that calls it on a schedule.

The runner is the durable part. It lives in the repo, detects what checks are available, runs them in a stable order, records failures, and applies only conservative fixes on a fresh branch. The automation is only a scheduler that wakes up later and executes the same runner.

This keeps the behavior transparent, testable, and portable. A future repo only needs the same runner contract plus project-specific checks.

## Alternatives Considered

### 1. Report-only overnight scanner

Pros:

- Lowest risk.
- Easy to trust.

Cons:

- Leaves most of the work for a human.
- Does not create much morning momentum.

### 2. Auto-fix on branch with risk policy

Pros:

- Best balance of safety and value.
- Preserves a review boundary before merge.
- Works well with scheduled runs.

Cons:

- Needs clear guardrails.
- Some failures will still remain manual.

### 3. Auto-fix and merge automatically

Pros:

- Lowest hands-on work when it succeeds.

Cons:

- Too risky for product logic and deployment behavior.
- Hard to trust without a mature CI and test suite.

## Safety Model

Every run follows two phases:

1. Scan the repository and collect signals.
2. Decide whether to report, auto-fix, or stop based on risk policy.

The runner must refuse to proceed when:

- the git worktree is dirty
- it cannot create a fresh branch
- required runtime tools are missing
- a proposed fix touches restricted areas
- too many files would change from one fix attempt

### Auto-fix allowed

- formatting and lint nits
- missing imports and obvious unused code cleanup
- small TypeScript issues proven by typecheck output
- straightforward updates to existing low-risk tests
- targeted package metadata cleanup when machine-verifiable

### Report-only areas

- auth and access control
- payments and billing
- database migrations or schema changes
- scheduling and booking logic
- secrets, deployment configuration, and environment wiring
- broad refactors or deletes

### Output guarantees

The runner never commits directly to `main`. It creates a fresh branch named like `codex/overnight-bug-sweep-YYYY-MM-DD-HHMM`, commits only if checks improve or remain green, and writes a run summary describing:

- checks that were discovered
- checks that passed
- failures that were found
- fixes that were applied
- items intentionally left for human review

## System Components

### 1. Sweep entrypoint

A repo command such as `npm run bug-sweep` becomes the single entry point.

### 2. Project detector

This module inspects the repo and determines which commands are available. For this codebase, the initial detector should understand:

- `npm run lint`
- `npm run build`
- explicit `npm run typecheck` if present
- explicit `npm test` if present
- fallback `node --test scripts/*.test.mjs` when there is no general test script

Missing checks are reported as setup debt instead of guessed.

### 3. Branch manager

This module verifies a clean tree, creates the sweep branch, and aborts safely if isolation fails.

### 4. Fix engine

This module applies bounded fixes from a conservative catalog. Initial support should focus on:

- ESLint `--fix`
- safe package maintenance checks
- small codemod-style fixes when they are directly tied to a known failure class

### 5. Report writer

This module writes a markdown summary into a predictable folder such as `reports/bug-sweeps/`.

## Run Flow

1. Verify clean git state.
2. Detect available checks.
3. Run checks in this order: lint, typecheck, tests, build.
4. Capture pass/fail results with stdout and stderr excerpts.
5. Create a sweep branch.
6. Attempt only approved low-risk fixes.
7. Re-run the affected checks.
8. Commit fixes only when the result is at least as healthy as before.
9. Write the human-readable report.
10. Exit with a status that reflects whether unresolved failures remain.

## Portability Rules

To keep this usable across future repos, the first version should target a narrow contract instead of pretending to support every stack:

- primary target: Node and TypeScript repos
- detection based on existing scripts and known file patterns
- clear messages when a repo is unsupported or only partially supported

This repo is a good first target because it already has `npm`, ESLint, Next.js build checks, and `node:test` scripts.

## UX Requirements

The morning summary should be understandable without reading raw terminal output.

It should have these sections:

- overall result
- branch created
- checks run
- fixes applied
- still failing
- recommended next step

If no fixes are safe, the report should say that plainly instead of implying progress.

## Testing Strategy

The implementation should include tests for:

- project detection
- dirty-tree refusal
- branch name generation
- report generation
- fallback test detection for `scripts/*.test.mjs`
- risk policy decisions that force report-only behavior

An end-to-end dry-run path should verify that the runner can inspect this repo without mutating it.

## Open Decisions

The first version should use markdown reports on disk plus console output. It does not need database storage, dashboards, or auto-PR creation yet.

The first version should also limit auto-fix scope to lint and closely related low-risk code cleanup. More aggressive fixers can be added later only after there is trust in the reporting and branch workflow.
