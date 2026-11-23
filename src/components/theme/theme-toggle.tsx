"use client";

import { Check, Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { useTheme } from "@/components/theme/theme-provider";
import { cn } from "@/lib/cn";
import type { Theme } from "@/lib/theme";

const options: { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

function themeLabel(theme: Theme): string {
  return options.find((option) => option.value === theme)?.label ?? "System";
}

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const menu = menuRef.current;
    const active = menu?.querySelector<HTMLButtonElement>(
      '[aria-checked="true"]',
    );
    const first = menu?.querySelector<HTMLButtonElement>("button");

    (active ?? first)?.focus();
  }, [open]);

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) return;

    event.preventDefault();

    const buttons = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );
    if (buttons.length === 0) return;

    const currentIndex = buttons.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    let nextIndex: number;

    if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = buttons.length - 1;
    } else if (event.key === "ArrowDown") {
      nextIndex =
        currentIndex < 0 ? 0 : (currentIndex + 1) % buttons.length;
    } else {
      nextIndex =
        currentIndex <= 0 ? buttons.length - 1 : currentIndex - 1;
    }

    buttons[nextIndex]?.focus();
  };

  const CurrentIcon =
    theme === "system" ? Monitor : resolvedTheme === "dark" ? Moon : Sun;

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={`Theme: ${themeLabel(theme)}. Change theme.`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? "theme-menu" : undefined}
        title="Change theme"
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-300 bg-surface text-zinc-600 shadow-sm transition hover:bg-zinc-50 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <CurrentIcon className="h-4 w-4" aria-hidden="true" />
      </button>

      {open ? (
        <div
          ref={menuRef}
          id="theme-menu"
          role="menu"
          aria-label="Theme"
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 z-50 mt-2 w-36 rounded-lg border border-zinc-200 bg-surface p-1 shadow-lg"
        >
          {options.map((option) => {
            const Icon = option.icon;
            const active = theme === option.value;

            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  setTheme(option.value);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition",
                  active
                    ? "bg-zinc-100 text-zinc-900"
                    : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span className="flex-1">{option.label}</span>
                {active ? (
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
