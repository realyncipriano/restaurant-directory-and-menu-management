import { describe, expect, it } from "vitest";

import { parseRecoveryAppUrl } from "@/lib/recovery-url";

describe("parseRecoveryAppUrl", () => {
  it("accepts HTTPS public hostnames and normalizes the origin", () => {
    expect(
      parseRecoveryAppUrl("https://menus.example.com/some/path?query=1"),
    ).toBe("https://menus.example.com");
    expect(parseRecoveryAppUrl("https://8.8.8.8:8443")).toBe(
      "https://8.8.8.8:8443",
    );
    expect(parseRecoveryAppUrl("https://[2606:4700:4700::1111]")).toBe(
      "https://[2606:4700:4700::1111]",
    );
  });

  it("normalizes trailing-dot hostnames", () => {
    expect(parseRecoveryAppUrl("https://menus.example.com./path")).toBe(
      "https://menus.example.com",
    );
    expect(parseRecoveryAppUrl("https://8.8.8.8./path")).toBe(
      "https://8.8.8.8",
    );
  });

  it("rejects plain HTTP by default", () => {
    expect(() => parseRecoveryAppUrl("http://menus.example.com")).toThrow(
      /https/,
    );
  });

  it.each([
    "http://localhost:3000",
    "http://localhost.:3000",
    "http://app.localhost:3000",
    "http://localhost.localdomain:3000",
    "https://localhost",
    "https://localhost.",
    "https://app.localhost.",
    "https://internal",
    "https://menus.internal",
    "https://menus.local",
    "https://menus.lan",
    "https://menus.home",
    "https://menus.home.arpa",
    "https://menus.corp",
  ])("rejects local or single-label host %s", (value) => {
    expect(() => parseRecoveryAppUrl(value)).toThrow();
  });

  it.each([
    "https://127.0.0.1",
    "https://127.0.0.2",
    "https://127.1",
    "https://2130706433",
    "https://0x7f.0.0.1",
    "https://0.0.0.0",
    "https://10.0.0.1",
    "https://172.16.0.1",
    "https://172.31.255.254",
    "https://192.168.1.1",
    "https://169.254.1.1",
    "https://100.64.0.1",
    "https://192.0.2.1",
    "https://192.88.99.1",
    "https://198.51.100.1",
    "https://203.0.113.1",
    "https://224.0.0.1",
    "https://240.0.0.1",
  ])("rejects prohibited IPv4 address %s", (value) => {
    expect(() => parseRecoveryAppUrl(value)).toThrow();
  });

  it.each([
    "https://[::]",
    "https://[::1]",
    "https://[0:0:0:0:0:0:0:1]",
    "https://[::127.0.0.1]",
    "https://[::ffff:0:127.0.0.1]",
    "https://[::ffff:0:7f00:1]",
    "https://[::ffff:127.0.0.1]",
    "https://[::ffff:7f00:1]",
    "https://[100::1]",
    "https://[fe80::1]",
    "https://[fd00::1]",
    "https://[fc00::1]",
    "https://[ff00::1]",
    "https://[2001:db8::1]",
    "https://[2001::1]",
    "https://[2002::1]",
    "https://[64:ff9b::1]",
    "https://[64:ff9b:1::1]",
  ])("rejects prohibited IPv6 address %s", (value) => {
    expect(() => parseRecoveryAppUrl(value)).toThrow();
  });

  it("does not resolve DNS names before validation", () => {
    expect(parseRecoveryAppUrl("https://localtest.me")).toBe(
      "https://localtest.me",
    );
  });

  it("rejects malformed URLs, unsupported schemes, and credentials", () => {
    expect(() => parseRecoveryAppUrl("not-a-url")).toThrow(/absolute URL/);
    expect(() => parseRecoveryAppUrl("https://")).toThrow(/absolute URL/);
    expect(() => parseRecoveryAppUrl("ftp://menus.example.com")).toThrow(
      /http or https/,
    );
    expect(() =>
      parseRecoveryAppUrl("https://user:pass@menus.example.com"),
    ).toThrow(/credentials/);
  });

  it("allows local HTTP URLs only through the explicit development option", () => {
    expect(
      parseRecoveryAppUrl("http://localhost:3000/some/path", {
        allowDevelopmentUrl: true,
      }),
    ).toBe("http://localhost:3000");
    expect(
      parseRecoveryAppUrl("http://127.0.0.1:3000", {
        allowDevelopmentUrl: true,
      }),
    ).toBe("http://127.0.0.1:3000");
    expect(
      parseRecoveryAppUrl("http://[::1]:3000", {
        allowDevelopmentUrl: true,
      }),
    ).toBe("http://[::1]:3000");
  });

  it("still rejects malformed URLs and credentials in development mode", () => {
    expect(() =>
      parseRecoveryAppUrl("not-a-url", { allowDevelopmentUrl: true }),
    ).toThrow(/absolute URL/);
    expect(() =>
      parseRecoveryAppUrl("ftp://localhost:3000", {
        allowDevelopmentUrl: true,
      }),
    ).toThrow(/http or https/);
    expect(() =>
      parseRecoveryAppUrl("http://user:pass@localhost:3000", {
        allowDevelopmentUrl: true,
      }),
    ).toThrow(/credentials/);
  });
});
