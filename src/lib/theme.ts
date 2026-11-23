export const THEME_STORAGE_KEY = "menu-directory-theme";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

export function parseTheme(value: string | null | undefined): Theme {
  return isTheme(value) ? value : "system";
}

export function resolveTheme(
  theme: Theme,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (theme === "system") {
    return systemPrefersDark ? "dark" : "light";
  }

  return theme;
}

export function getSystemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;

  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

let memoryTheme: Theme = "system";

export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return memoryTheme;

  try {
    memoryTheme = parseTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    // Storage can be unavailable in private browsing; use the in-memory value.
  }

  return memoryTheme;
}

export function setStoredTheme(theme: Theme): void {
  memoryTheme = theme;

  if (typeof window === "undefined") return;

  try {
    if (theme === "system") {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  } catch {
    // Keep the in-memory preference when storage is unavailable.
  }
}

export function applyResolvedTheme(theme: ResolvedTheme): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  const isDark = theme === "dark";

  root.classList.toggle("dark", isDark);
  root.style.colorScheme = theme;

  const meta = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  if (meta) {
    meta.content = isDark ? "#15110d" : "#faf8f3";
  }
}

export const themeInitScript = `(function(){var key="${THEME_STORAGE_KEY}";var dark=false;try{var stored=window.localStorage.getItem(key);var theme=stored==="light"||stored==="dark"||stored==="system"?stored:"system";dark=theme==="dark"||(theme==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);}catch(error){try{dark=window.matchMedia("(prefers-color-scheme: dark)").matches;}catch(mediaError){dark=false;}}var root=document.documentElement;root.classList.toggle("dark",dark);root.style.colorScheme=dark?"dark":"light";var meta=document.querySelector('meta[name="theme-color"]');if(meta){meta.setAttribute("content",dark?"#15110d":"#faf8f3");}})();`;
