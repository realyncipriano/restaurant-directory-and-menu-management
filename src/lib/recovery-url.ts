import { BlockList, isIP } from "node:net";

export type RecoveryAppUrlOptions = {
  /**
   * Explicitly allow an HTTP or non-public host. This exists only for local
   * development and must never be enabled for a production recovery command.
   */
  allowDevelopmentUrl?: boolean;
};

const blockedAddresses = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["100::", 64],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001::", 32],
  ["2001:1::1", 128],
  ["2001:1::2", 128],
  ["2001:4:112::", 48],
  ["2001:10::", 28],
  ["2001:20::", 28],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv6");
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function normalizeHostname(hostname: string): string {
  return stripIpv6Brackets(hostname).toLowerCase().replace(/\.+$/, "");
}

function ipv4FromMappedIpv6(hostname: string): string | null {
  if (!hostname.startsWith("::ffff:")) return null;
  const tail = hostname.slice("::ffff:".length);
  if (tail.includes(".")) return tail;

  const groups = tail.split(":");
  if (groups.length !== 2) return null;
  const high = Number.parseInt(groups[0] ?? "", 16);
  const low = Number.parseInt(groups[1] ?? "", 16);
  if (!Number.isInteger(high) || !Number.isInteger(low)) return null;

  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

function isBlockedAddress(hostname: string): boolean {
  const mappedIpv4 = ipv4FromMappedIpv6(hostname);
  if (mappedIpv4) {
    return blockedAddresses.check(mappedIpv4, "ipv4");
  }

  const family = isIP(hostname);
  if (family === 4) return blockedAddresses.check(hostname, "ipv4");
  if (family === 6) return blockedAddresses.check(hostname, "ipv6");
  return false;
}

function isProhibitedHost(hostname: string): boolean {
  if (!hostname || hostname.includes("%")) return true;
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "localhost.localdomain" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".localdomain") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".lan") ||
    hostname.endsWith(".home") ||
    hostname.endsWith(".home.arpa") ||
    hostname.endsWith(".corp")
  ) {
    return true;
  }

  const family = isIP(hostname);
  if (family !== 0) return isBlockedAddress(hostname);

  // A single-label hostname cannot be a public DNS name. Fail closed unless
  // the operator explicitly opted into development URLs.
  return !hostname.includes(".");
}

/**
 * Validates and normalizes the application base URL used for recovery links.
 *
 * In the default (production-safe) mode only HTTPS URLs with a public-looking
 * hostname are accepted. Private, loopback, link-local, and reserved address
 * ranges are rejected. Hostnames are not resolved with DNS, so an operator
 * must still ensure the configured public hostname resolves to the intended
 * application.
 */
export function parseRecoveryAppUrl(
  rawAppUrl: string,
  options: RecoveryAppUrlOptions = {},
): string {
  let url: URL;
  try {
    url = new URL(rawAppUrl);
  } catch {
    throw new Error("APP_URL must be an absolute URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("APP_URL must use http or https.");
  }
  if (url.username || url.password) {
    throw new Error("APP_URL must not include credentials.");
  }

  const hostname = normalizeHostname(url.hostname);
  if (!hostname) {
    throw new Error("APP_URL must include a hostname.");
  }

  if (!options.allowDevelopmentUrl) {
    if (url.protocol !== "https:") {
      throw new Error("APP_URL must use https for administrator recovery.");
    }
    if (isProhibitedHost(hostname)) {
      throw new Error(
        "APP_URL must not point at localhost or a private, loopback, link-local, or reserved address.",
      );
    }
  }

  const originHost = hostname.includes(":") ? `[${hostname}]` : hostname;
  const originPort = url.port ? `:${url.port}` : "";
  return `${url.protocol}//${originHost}${originPort}`;
}
