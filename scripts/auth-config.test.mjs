import assert from "node:assert/strict";
import test from "node:test";

import {
  hasRequiredClerkServerKeys,
  shouldAllowMissingClerkAuthBypass,
} from "../lib/auth.ts";

test("hasRequiredClerkServerKeys requires both Clerk keys", () => {
  assert.equal(
    hasRequiredClerkServerKeys({
      CLERK_SECRET_KEY: "secret",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "publishable",
    }),
    true,
  );
  assert.equal(
    hasRequiredClerkServerKeys({
      CLERK_SECRET_KEY: "secret",
    }),
    false,
  );
  assert.equal(
    hasRequiredClerkServerKeys({
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "publishable",
    }),
    false,
  );
});

test("missing Clerk auth bypass is only allowed outside production", () => {
  assert.equal(
    shouldAllowMissingClerkAuthBypass({
      NODE_ENV: "development",
    }),
    true,
  );
  assert.equal(
    shouldAllowMissingClerkAuthBypass({
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
    }),
    true,
  );
  assert.equal(
    shouldAllowMissingClerkAuthBypass({
      NODE_ENV: "production",
      VERCEL_ENV: "production",
    }),
    false,
  );
  assert.equal(
    shouldAllowMissingClerkAuthBypass({
      NODE_ENV: "production",
    }),
    false,
  );
});
