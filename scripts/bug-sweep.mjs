import {
  applyAllowedFixes,
  collectFailures,
  commitSweepChanges,
  createSweepBranch,
  decideFixPlan,
  detectProjectChecks,
  ensureCleanTree,
  formatSweepSummary,
  hasTrackedChanges,
  loadProjectContext,
  mergeCheckResults,
  runChecks,
  writeReport,
} from "./lib/bug-sweep/index.mjs";

const dryRun = process.argv.includes("--dry-run");
const cwd = process.cwd();

try {
  await ensureCleanTree();

  const context = await loadProjectContext({ cwd });
  const checks = detectProjectChecks(context);
  const missingChecks = collectMissingChecks({ checks });
  const initialResults = await runChecks({ checks, cwd });
  const fixPlan = decideFixPlan({ results: initialResults });

  let branchName = null;
  let fixes = [];
  let finalResults = initialResults;

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

  const unresolved = Array.from(
    new Set([...collectFailures(finalResults), ...fixPlan.reportOnly]),
  );

  const summary = formatSweepSummary({
    branchName: dryRun ? "dry-run" : branchName,
    fixes,
    missingChecks,
    results: finalResults,
    unresolved,
  });
  const reportPath = await writeReport({ cwd, summary });

  console.log(summary);
  console.log(`\nReport written to ${reportPath}`);

  if (unresolved.length > 0) {
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
