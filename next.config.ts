import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    // Pin to the package root so worktree checkouts do not inherit a parent lockfile root.
    root: projectRoot,
  },
};

export default nextConfig;
