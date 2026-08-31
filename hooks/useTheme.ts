import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "theme";

export function useTheme() {
    // Match app/layout.tsx's default (light) so there's no flash when the user
  // hasn't explicitly chosen a theme yet.
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    let saved: Theme | null = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
    } catch {
      /* storage blocked — ignore */
    }
    const resolved: Theme =
      saved === "light" || saved === "dark" ? saved : "light";
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolved);
    setTheme(resolved);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage blocked — ignore */
    }
    setTheme(next);
  }

  return { theme, isDark: theme === "dark", toggle, mounted };
}
