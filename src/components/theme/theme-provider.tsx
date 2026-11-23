"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  applyResolvedTheme,
  getStoredTheme,
  getSystemPrefersDark,
  resolveTheme,
  setStoredTheme,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type Theme,
} from "@/lib/theme";

const THEME_CHANGE_EVENT = "menu-directory-theme-change";

type ThemeContextValue = {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

type ThemeSnapshot = {
  theme: Theme;
  systemPrefersDark: boolean;
};

const SERVER_SNAPSHOT: ThemeSnapshot = {
  theme: "system",
  systemPrefersDark: false,
};

let cachedSnapshot: ThemeSnapshot = {
  theme: "system",
  systemPrefersDark: false,
};

function subscribeToTheme(callback: () => void): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) callback();
  };

  window.addEventListener("storage", onStorage);
  window.addEventListener(THEME_CHANGE_EVENT, callback);
  media.addEventListener("change", callback);

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(THEME_CHANGE_EVENT, callback);
    media.removeEventListener("change", callback);
  };
}

function getThemeSnapshot(): ThemeSnapshot {
  const theme = getStoredTheme();
  const systemPrefersDark = getSystemPrefersDark();

  if (
    cachedSnapshot.theme !== theme ||
    cachedSnapshot.systemPrefersDark !== systemPrefersDark
  ) {
    cachedSnapshot = { theme, systemPrefersDark };
  }

  return cachedSnapshot;
}

function getServerThemeSnapshot(): ThemeSnapshot {
  return SERVER_SNAPSHOT;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    getServerThemeSnapshot,
  );
  const { theme, systemPrefersDark } = snapshot;
  const resolvedTheme = resolveTheme(theme, systemPrefersDark);
  // The inline script already applied the stored theme before hydration.
  // Wait for the client snapshot so the server snapshot cannot briefly
  // override the theme that is already on the document.
  const hasClientSnapshot = snapshot !== SERVER_SNAPSHOT;

  useEffect(() => {
    if (!hasClientSnapshot) return;

    applyResolvedTheme(resolvedTheme);
  }, [hasClientSnapshot, resolvedTheme]);

  const setTheme = useCallback((nextTheme: Theme) => {
    setStoredTheme(nextTheme);
    applyResolvedTheme(resolveTheme(nextTheme, getSystemPrefersDark()));
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }, []);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }

  return context;
}
