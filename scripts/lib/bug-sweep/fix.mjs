import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export function decideFixPlan({ results }) {
  const allowedFixes = [];
  const reportOnly = [];

  for (const result of results) {
    if (result.status !== "failed") {
      continue;
    }

    if (result.id === "lint") {
      allowedFixes.push("lint");
      continue;
    }

    reportOnly.push(result.id);
  }

  return { allowedFixes, reportOnly };
}

export async function applyAllowedFixes({ allowedFixes, cwd }) {
  const fixes = [];

  if (allowedFixes.includes("lint")) {
    await execFile("npx", ["eslint", ".", "--fix"], {
      cwd,
      encoding: "utf8",
    });
    fixes.push("Applied eslint --fix");
  }

  return fixes;
}
