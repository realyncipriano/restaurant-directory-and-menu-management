const BROWSERS: Array<[RegExp, string]> = [
  [/\bEdg(?:A|iOS)?\//, "Edge"],
  [/\bOPR\/|\bOpera\//, "Opera"],
  [/\bChrome\/|\bCriOS\//, "Chrome"],
  [/\bFirefox\/|\bFxiOS\//, "Firefox"],
  [/\bSafari\//, "Safari"],
];

const PLATFORMS: Array<[RegExp, string]> = [
  [/\biPhone\b/, "iPhone"],
  [/\biPad\b/, "iPad"],
  [/\bAndroid\b/, "Android"],
  [/\bWindows NT\b/, "Windows"],
  [/\bMac OS X\b/, "macOS"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bLinux\b/, "Linux"],
];

function match(value: string, candidates: Array<[RegExp, string]>): string | null {
  for (const [pattern, label] of candidates) {
    if (pattern.test(value)) return label;
  }
  return null;
}

/** Derives a short, safe label from a stored user agent string. */
export function describeUserAgent(value: string | null | undefined): string {
  if (!value?.trim()) return "Unknown device";

  const browser = match(value, BROWSERS);
  const platform = match(value, PLATFORMS);
  if (browser && platform) return `${browser} on ${platform}`;
  if (browser) return browser;
  if (platform) return platform;
  return "Unknown device";
}
