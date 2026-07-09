import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export async function runChecks({ checks, cwd, ids } = {}) {
  const selectedIds = ids ? new Set(ids) : null;
  const results = [];

  for (const check of checks) {
    if (selectedIds && !selectedIds.has(check.id)) {
      continue;
    }

    results.push(await runCheck({ check, cwd }));
  }

  return results;
}

export function collectFailures(results) {
  return results
    .filter((result) => result.status === "failed")
    .map((result) => result.id);
}

export function mergeCheckResults({ baselineResults, updatedResults }) {
  const updatesById = new Map(updatedResults.map((result) => [result.id, result]));

  return baselineResults.map((result) => updatesById.get(result.id) ?? result);
}

async function runCheck({ check, cwd }) {
  try {
    const { stderr, stdout } = await execFile(check.command, check.args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 20,
    });

    return {
      id: check.id,
      label: check.label,
      output: [stdout, stderr].filter(Boolean).join("\n").trim(),
      status: "passed",
    };
  } catch (error) {
    return {
      id: check.id,
      label: check.label,
      output: [error.stdout, error.stderr].filter(Boolean).join("\n").trim(),
      status: "failed",
    };
  }
}
