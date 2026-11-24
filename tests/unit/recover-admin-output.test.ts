import { describe, expect, it } from "vitest";

import { recoveryOutputLines } from "../../scripts/recover-admin-output";

const URL = "https://menus.example.com/activate?token=single-use-token";

describe("administrator recovery CLI output", () => {
  it("warns that the token is retained in standard output and log capture", () => {
    const { warning } = recoveryOutputLines({
      email: "admin@example.com",
      url: URL,
    });

    expect(warning).toMatch(/standard output/);
    expect(warning).toMatch(/CI logs/);
    expect(warning).toMatch(/tee/);
    expect(warning).toMatch(/scrollback/);
  });

  it("prints the recovery URL exactly once with delivery guidance", () => {
    const { lines } = recoveryOutputLines({
      email: "admin@example.com",
      url: URL,
    });

    expect(lines.filter((line) => line === URL)).toHaveLength(1);
    expect(lines[0]).toContain("admin@example.com");
    expect(lines.at(-1)).toMatch(/secure channel/);
    expect(lines.at(-1)).toMatch(/single-use/);
    expect(lines.join(" ")).not.toMatch(/Multi-factor authentication was disabled/);
  });

  it("warns when recovery also resets MFA", () => {
    const { lines } = recoveryOutputLines({
      email: "admin@example.com",
      url: URL,
      mfaReset: true,
    });

    expect(lines.join(" ")).toMatch(/Multi-factor authentication was disabled/);
    expect(lines.filter((line) => line === URL)).toHaveLength(1);
  });
});
