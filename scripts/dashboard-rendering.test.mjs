import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const projectRoot = process.cwd();

const dashboardPages = [
  "app/dashboard/page.tsx",
  "app/dashboard/clients/page.tsx",
  "app/dashboard/settings/page.tsx",
];

for (const relativePath of dashboardPages) {
  test(`${relativePath} forces dynamic rendering for live data`, async () => {
    const source = await readFile(path.join(projectRoot, relativePath), "utf8");

    assert.match(
      source,
      /export const dynamic = ["']force-dynamic["'];/,
      "expected the page to opt out of prerendered dashboard HTML",
    );
  });
}
