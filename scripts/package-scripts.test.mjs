import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

test("package scripts expose one reliable verification entrypoint", () => {
  assert.equal(packageJson.scripts.lint, "eslint app lib components scripts");
  assert.equal(packageJson.scripts.typecheck, "tsc --noEmit --pretty false");
  assert.equal(
    packageJson.scripts.test,
    "node --experimental-strip-types --experimental-test-module-mocks --test scripts/*.test.mjs",
  );
  assert.equal(
    packageJson.scripts.verify,
    "npm run lint && npm run typecheck && npm test && npm run build",
  );
});
