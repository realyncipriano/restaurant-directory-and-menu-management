import { describe, expect, it } from "vitest";

import { deploymentCommitSha } from "@/lib/build-info";

const SHA = "e857ba2586e1b9085386863c1276a4b6f87e9c5f";

function env(values: Record<string, string>): NodeJS.ProcessEnv {
  return values as unknown as NodeJS.ProcessEnv;
}

describe("deployment commit metadata", () => {
  it("prefers the hosting platform commit and normalizes it", () => {
    expect(
      deploymentCommitSha(
        env({
          VERCEL_GIT_COMMIT_SHA: SHA.toUpperCase(),
          GITHUB_SHA: "1".repeat(40),
        }),
      ),
    ).toBe(SHA);
  });

  it("falls back to the build commit and ignores invalid values", () => {
    expect(
      deploymentCommitSha(env({ BUILD_COMMIT_SHA: SHA })),
    ).toBe(SHA);
    expect(
      deploymentCommitSha(
        env({
          BUILD_COMMIT_SHA: "not-a-sha",
          NEXT_PUBLIC_BUILD_SHA: "2".repeat(40),
        }),
      ),
    ).toBe("2".repeat(40));
  });

  it("returns null when no valid commit is configured", () => {
    expect(deploymentCommitSha(env({}))).toBeNull();
  });
});
