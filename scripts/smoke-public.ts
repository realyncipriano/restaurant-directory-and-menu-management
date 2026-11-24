import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  exitCodeForReport,
  runPublicSmoke,
  type PublicSmokeReport,
} from "./lib/public-smoke";

function argument(name: string): string | undefined {
  const inline = process.argv.find((value) =>
    value.startsWith(`--${name}=`),
  );
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function booleanEnv(value: string | undefined): boolean {
  return /^(?:1|true|yes)$/i.test(value?.trim() ?? "");
}

function positiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function printReport(report: PublicSmokeReport): void {
  console.log(`Public smoke: ${report.base}`);
  console.log(`Generated:   ${report.generatedAt}`);
  console.log(`Commit:      ${report.commit ?? "unknown"}`);
  if (report.expectedCommit) {
    console.log(`Expected:    ${report.expectedCommit}`);
  }
  console.log("");

  for (const check of report.checks) {
    console.log(`${check.result.padEnd(7)} ${check.id}`);
    if (check.failure) console.log(`        ${check.failure}`);
  }

  console.log("");
  console.log(
    `Summary: ${report.summary.pass} passed, ${report.summary.fail} failed, ${report.summary.blocked} blocked (${report.summary.total} checks)`,
  );
}

async function main(): Promise<void> {
  if (flag("help")) {
    console.log(
      [
        "Usage: npm run smoke:public -- [options]",
        "",
        "Options:",
        "  --base <url>             Base URL (default: SMOKE_BASE_URL or http://localhost:3000)",
        "  --expected-sha <sha>     Expected deployed commit (default: SMOKE_EXPECTED_SHA)",
        "  --restaurant <slug>      Known public restaurant slug (default: SMOKE_RESTAURANT_SLUG)",
        "  --menu <slug>            Known public menu slug (default: SMOKE_MENU_SLUG)",
        "  --output <file>          Write the JSON report to a file",
        "  --require-documents      Exit 2 when document checks are blocked",
        "  --help                   Show this message",
        "",
        "This command is read-only. It never sends cookies, credentials, or",
        "mutation requests.",
      ].join("\n"),
    );
    return;
  }

  const baseUrl =
    argument("base") ??
    process.env.SMOKE_BASE_URL ??
    "http://localhost:3000";
  const output = argument("output") ?? process.env.SMOKE_OUTPUT;

  try {
    const report = await runPublicSmoke({
      baseUrl,
      expectedCommit:
        argument("expected-sha") ?? process.env.SMOKE_EXPECTED_SHA,
      restaurantSlug:
        argument("restaurant") ?? process.env.SMOKE_RESTAURANT_SLUG,
      menuSlug: argument("menu") ?? process.env.SMOKE_MENU_SLUG,
      timeoutMs: positiveInteger(process.env.SMOKE_TIMEOUT_MS),
    });

    printReport(report);

    if (output) {
      const path = resolve(output);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      console.log(`JSON report: ${path}`);
    }

    const requireDocuments =
      flag("require-documents") ||
      booleanEnv(process.env.SMOKE_REQUIRE_DOCUMENTS);
    process.exitCode = exitCodeForReport(report, requireDocuments);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown smoke error.";
    console.error(`Public smoke could not run: ${message}`);
    process.exitCode = 2;
  }
}

void main();
