# Overnight Bug Sweep

This project now includes a conservative bug-sweep command that is designed for unattended runs.

## What It Does

The sweep:

- verifies the repo is clean before it starts
- discovers the checks this repo actually supports
- runs lint, typecheck, tests, and build when available
- auto-fixes only low-risk issues right now
- writes a human-readable markdown report
- never applies changes directly to `main`

## Safe Fix Scope

The first version only auto-fixes lint issues with `eslint --fix`.

If the sweep finds failures in higher-risk areas such as build, business logic, or missing setup, it reports them instead of trying to rewrite the app blindly.

## Commands

Dry inspection with no branch creation or code changes:

```bash
npm run bug-sweep:dry-run
```

Full safe sweep:

```bash
npm run bug-sweep
```

## Reports

Each run writes a markdown summary to:

```text
reports/bug-sweeps/
```

Those report files are ignored by git so repeated runs do not dirty the repository.

## Branch Behavior

If the sweep finds a lint failure that it can safely fix, it creates a branch named like:

```text
codex/overnight-bug-sweep-20260417T020000Z
```

It then commits the safe fixes on that branch and leaves the morning report behind so you can review what happened.
