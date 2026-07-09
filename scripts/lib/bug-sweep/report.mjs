import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export function getReportPath({ cwd, now = new Date() }) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return path.join(cwd, "reports", "bug-sweeps", `${stamp}.md`);
}

export function formatSweepSummary({
    branchName,
    fixes,
    manualReviewNeeded,
    missingChecks,
    results,
    unresolved,
    worktreeNotes = [],
  }) {
  const needsManualReview = manualReviewNeeded ?? unresolved.length > 0;

  return [
    "# Overnight Bug Sweep",
    "",
    "## Overall Result",
    !needsManualReview
      ? "Everything discovered by the sweep is green."
      : "Manual review is still needed before this repo is considered clean.",
    "",
    "## Worktree Handling",
    formatBulletList(worktreeNotes),
    "",
    "## Branch Created",
    branchName || "None",
    "",
    "## Missing Checks",
    formatBulletList(missingChecks),
    "",
    "## Fixes Applied",
    formatBulletList(fixes),
    "",
    "## Still Failing",
    formatBulletList(unresolved),
    "",
    "## Checks Run",
    formatBulletList(results.map((result) => `${result.id}: ${result.status}`)),
  ].join("\n");
}

export async function writeReport({ cwd, now = new Date(), summary }) {
  const reportPath = getReportPath({ cwd, now });

  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${summary}\n`, "utf8");

  return reportPath;
}

function formatBulletList(items) {
  if (!items || items.length === 0) {
    return "- None";
  }

  return items.map((item) => `- ${item}`).join("\n");
}
