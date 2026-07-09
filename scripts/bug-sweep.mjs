import {
  applyAllowedFixes,
  collectFailures,
  commitSweepChanges,
  createSweepBranch,
  decideFixPlan,
  detectProjectChecks,
  formatSweepSummary,
  hasTrackedChanges,
  loadProjectContext,
  mergeCheckResults,
  prepareWorktree,
  restoreWorktree,
  runChecks,
  writeReport,
} from "./lib/bug-sweep/index.mjs";

const dryRun = process.argv.includes("--dry-run");
const autoStashDirtyTree = process.argv.includes("--auto-stash-dirty-tree");
const cwd = process.cwd();

try {
  const worktreeState = await prepareWorktree({ autoStashDirtyTree, cwd });

  let branchName = null;
  let finalResults = [];
  let fixes = [];
  let missingChecks = [];
  let unresolved = [];
  let restoreResult = null;

  try {
    const context = await loadProjectContext({ cwd });
    const checks = detectProjectChecks(context);
    missingChecks = collectMissingChecks({ checks });
    const initialResults = await runChecks({ checks, cwd });
    const fixPlan = decideFixPlan({ results: initialResults });

    finalResults = initialResults;

    if (!dryRun && fixPlan.allowedFixes.length > 0) {
      branchName = await createSweepBranch({ cwd });
      fixes = await applyAllowedFixes({
        allowedFixes: fixPlan.allowedFixes,
        cwd,
      });

      if (fixes.length > 0) {
        const rerunResults = await runChecks({
          checks,
          cwd,
          ids: fixPlan.allowedFixes,
        });

        finalResults = mergeCheckResults({
          baselineResults: initialResults,
          updatedResults: rerunResults,
        });

        if (await hasTrackedChanges({ cwd })) {
          await commitSweepChanges({
            cwd,
            message: "fix: apply overnight bug sweep safe fixes",
          });
        }
      }
    }

    unresolved = Array.from(
      new Set([...collectFailures(finalResults), ...fixPlan.reportOnly]),
    );
  } finally {
    restoreResult = await restoreWorktree({ cwd, sweepState: worktreeState });
  }

  const summary = formatSweepSummary({
    branchName: dryRun ? "dry-run" : branchName,
    fixes,
    manualReviewNeeded: unresolved.length > 0 || restoreResult?.restored === false,
    missingChecks,
    results: finalResults,
    unresolved,
    worktreeNotes: restoreResult?.notes ?? worktreeState.notes,
  });
  const reportPath = await writeReport({ cwd, summary });

  console.log(summary);
  console.log(`\nReport written to ${reportPath}`);

  if (restoreResult?.output) {
    console.error(`\nWorktree restore details:\n${restoreResult.output}`);
  }

  if (unresolved.length > 0 || restoreResult?.restored === false) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function collectMissingChecks({ checks }) {
  const present = new Set(checks.map((check) => check.id));
  const expected = ["lint", "typecheck", "tests", "build"];

  return expected.filter((id) => !present.has(id));
}
