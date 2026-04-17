#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const cwd = process.cwd();
const envPath = path.join(cwd, ".env.local");
const linkedPath = path.join(cwd, "supabase/.temp/linked-project.json");
const projectRefPath = path.join(cwd, "supabase/.temp/project-ref");

const env = readEnvFile(envPath);
const linked = readJsonIfExists(linkedPath);
const projectRef = readTextIfExists(projectRefPath)?.trim() ?? null;
const appUrl = env.NEXT_PUBLIC_SUPABASE_URL ?? null;

const checks = [
  {
    label: "Linked project ref",
    value: linked?.ref ?? projectRef ?? "missing",
  },
  {
    label: "Linked project name",
    value: linked?.name ?? "missing",
  },
  {
    label: "Supabase URL present",
    value: appUrl ? "yes" : "missing",
  },
  {
    label: "Service role key present",
    value: env.SUPABASE_SERVICE_ROLE_KEY ? "yes" : "missing",
  },
  {
    label: "Management API token present",
    value:
      env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_PAT || env.SUPABASE_TOKEN
        ? "yes"
        : "not in .env.local",
  },
  {
    label: "DB password present",
    value: env.SUPABASE_DB_PASSWORD ? "yes" : "missing",
  },
];

console.log("Supabase readiness");
console.log("");
for (const check of checks) {
  console.log(`${check.label}: ${check.value}`);
}

console.log("");
console.log("Useful local files:");
console.log(`- ${path.join(cwd, "supabase/migrations/20260416_sms_scheduling_reconciliation.sql")}`);
console.log(`- ${path.join(cwd, "supabase/migrations/20260416190000_sms_availability_tables_repair.sql")}`);
console.log(`- ${path.join(cwd, "scripts/sms-preview-fixture.sql")}`);
console.log(`- ${path.join(cwd, "supabase/bootstrap_schedule_slice.sql")}`);

console.log("");
console.log("Next commands:");
console.log("- npx supabase projects list");
console.log("- npx supabase db query --linked \"select current_database(), current_user;\"");
console.log("- npx supabase db query --linked -f supabase/migrations/20260416190000_sms_availability_tables_repair.sql");
console.log("- npx supabase db push --linked --dry-run");
console.log("- npx supabase db query --linked -f scripts/sms-preview-fixture.sql");

if (!env.SUPABASE_DB_PASSWORD) {
  console.log("");
  console.log("Manual ask:");
  console.log("- Provide the Supabase project database password, or reset/copy it from the Supabase dashboard.");
}

if (!env.SUPABASE_ACCESS_TOKEN && !env.SUPABASE_PAT && !env.SUPABASE_TOKEN) {
  console.log("");
  console.log("Note:");
  console.log("- The CLI can still be logged in via cached Supabase auth even if no management token is stored in .env.local.");
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const text = fs.readFileSync(filePath, "utf8");
  const result = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    const value = line.slice(equalsIndex + 1).trim();
    result[key] = stripQuotes(value);
  }

  return result;
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readTextIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return fs.readFileSync(filePath, "utf8");
}
