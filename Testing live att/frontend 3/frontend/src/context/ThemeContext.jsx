import { createContext, useContext, useEffect, useState } from 'react';

const ThemeCtx = createContext(null);

export function ThemeProvider({ children }) {
  const [isDark, setIsDark] = useState(() => {
    // Resolve saved preference, fall back to system setting
    try {
      const stored = localStorage.getItem('theme');
      if (stored === 'dark' || stored === 'light') {
        const dark = stored === 'dark';
        // Apply synchronously before first paint to prevent flash
        document.documentElement.classList.toggle('dark', dark);
        return dark;
      }
    } catch {}
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', prefersDark);
    return prefersDark;
  });

  // Keep html class and localStorage in sync whenever isDark changes
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    try { localStorage.setItem('theme', isDark ? 'dark' : 'light'); } catch {}
  }, [isDark]);

  return (
    <ThemeCtx.Provider value={{ isDark, toggle: () => setIsDark((v) => !v) }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export const useTheme = () => useContext(ThemeCtx);
