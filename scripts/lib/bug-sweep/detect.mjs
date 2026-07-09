import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export async function loadProjectContext({ cwd }) {
  return {
    cwd,
    files: await findScriptTestFiles({ cwd }),
    packageJson: await readPackageJson({ cwd }),
  };
}

export function detectProjectChecks({ packageJson, files = [] }) {
  const checks = [];
  const scripts = packageJson?.scripts ?? {};

  if (scripts.lint) {
    checks.push({
      args: ["run", "lint"],
      command: "npm",
      id: "lint",
      label: "ESLint",
    });
  }

  if (scripts.typecheck) {
    checks.push({
      args: ["run", "typecheck"],
      command: "npm",
      id: "typecheck",
      label: "TypeScript",
    });
  }

  if (scripts.test) {
    checks.push({
      args: ["test"],
      command: "npm",
      id: "tests",
      label: "Tests",
    });
  } else if (files.length > 0) {
    checks.push({
      args: ["--test", ...files],
      command: "node",
      id: "tests",
      label: "Fallback script tests",
    });
  }

  if (scripts.build) {
    checks.push({
      args: ["run", "build"],
      command: "npm",
      id: "build",
      label: "Production build",
    });
  }

  return checks;
}

async function readPackageJson({ cwd }) {
  const packageJsonPath = path.join(cwd, "package.json");
  const raw = await readFile(packageJsonPath, "utf8");
  return JSON.parse(raw);
}

async function findScriptTestFiles({ cwd }) {
  const scriptsDir = path.join(cwd, "scripts");
  const files = [];

  try {
    await walkDirectory({ currentDir: scriptsDir, files, rootDir: cwd });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  return files
    .filter((file) => file.endsWith(".test.mjs"))
    .sort((left, right) => left.localeCompare(right));
}

async function walkDirectory({ currentDir, files, rootDir }) {
  const entries = await readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      await walkDirectory({ currentDir: absolutePath, files, rootDir });
      continue;
    }

    files.push(path.relative(rootDir, absolutePath));
  }
}
