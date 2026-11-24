import { describe, expect, it } from "vitest";

import {
  buildCspReportOnlyPolicy,
  parseCspReport,
} from "@/lib/security/csp";

const ORIGIN = "https://menus.example.com";

describe("report-only CSP policy", () => {
  it("restricts high-risk directives and points reports at the local endpoint", () => {
    const policy = buildCspReportOnlyPolicy();

    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).toContain("report-uri /api/csp-report");
  });
});

describe("CSP report parsing", () => {
  it("sanitizes legacy reports so tokens and query strings never reach logs", () => {
    const report = parseCspReport(
      {
        "csp-report": {
          "document-uri": `${ORIGIN}/activate?token=super-secret#section`,
          "violated-directive": "script-src-elem",
          "effective-directive": "script-src-elem",
          "blocked-uri": "https://cdn.example/evil.js?token=super-secret",
          disposition: "report",
          "source-file": `${ORIGIN}/_next/static/chunk.js?token=super-secret`,
          "line-number": 12.9,
        },
      },
      ORIGIN,
    );

    expect(report).toEqual({
      directive: "script-src-elem",
      disposition: "report",
      blockedUri: "https://cdn.example/evil.js",
      documentPath: "/activate",
      sourceFile: `${ORIGIN}/_next/static/chunk.js`,
      lineNumber: 12,
    });
    expect(JSON.stringify(report)).not.toContain("super-secret");
  });

  it("accepts Reporting API arrays", () => {
    const report = parseCspReport(
      [
        {
          type: "csp-violation",
          body: {
            documentURL: `${ORIGIN}/dashboard/users?filter=active`,
            effectiveDirective: "img-src",
            blockedURL: `${ORIGIN}/dashboard/users?debug=1`,
            disposition: "report",
            lineNumber: 4,
          },
        },
      ],
      ORIGIN,
    );

    expect(report).toMatchObject({
      directive: "img-src",
      documentPath: "/dashboard/users",
      blockedUri: `${ORIGIN}/dashboard/users`,
      lineNumber: 4,
    });
    expect(JSON.stringify(report)).not.toContain("filter=active");
    expect(JSON.stringify(report)).not.toContain("debug=1");
  });

  it("keeps special blocked values such as inline and eval", () => {
    for (const blocked of ["inline", "eval", "data", "blob"]) {
      const report = parseCspReport(
        {
          "csp-report": {
            "document-uri": `${ORIGIN}/`,
            "blocked-uri": blocked,
          },
        },
        ORIGIN,
      );
      expect(report?.blockedUri).toBe(blocked);
    }
  });

  it("drops cross-origin documents and malformed payloads", () => {
    expect(
      parseCspReport(
        {
          "csp-report": {
            "document-uri": "https://evil.example/activate?token=x",
          },
        },
        ORIGIN,
      ),
    ).toBeNull();
    expect(parseCspReport(null, ORIGIN)).toBeNull();
    expect(parseCspReport([], ORIGIN)).toBeNull();
    expect(parseCspReport({ "csp-report": {} }, ORIGIN)).toBeNull();
    expect(
      parseCspReport(
        { "csp-report": { "document-uri": "not a url" } },
        ORIGIN,
      ),
    ).toBeNull();
  });

  it("treats relative blocked URIs as paths and removes their query", () => {
    const report = parseCspReport(
      {
        "csp-report": {
          "document-uri": `${ORIGIN}/dashboard`,
          "blocked-uri": "/api/upload?token=secret",
        },
      },
      ORIGIN,
    );

    expect(report?.blockedUri).toBe("/api/upload");
    expect(JSON.stringify(report)).not.toContain("secret");
  });
});
