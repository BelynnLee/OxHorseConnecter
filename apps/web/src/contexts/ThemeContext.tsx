import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Theme = 'hermes' | 'mono' | 'light' | 'onyx-pink' | 'spring-violet' | 'harbor-cyan';

export interface ThemeDefinition {
  id: Theme;
  label: string;
  description: string;
  density: 'comfortable' | 'spacious' | 'compact';
}

export const THEMES: ThemeDefinition[] = [
  {
    id: 'hermes',
    label: 'Hermes Teal',
    description: 'Dark teal dashboard with compact operational density.',
    density: 'comfortable',
  },
  {
    id: 'mono',
    label: 'Mono',
    description: 'Neutral grayscale for focused inspection.',
    density: 'comfortable',
  },
  {
    id: 'light',
    label: 'Light',
    description: 'Bright dashboard for daylight use.',
    density: 'comfortable',
  },
  {
    id: 'onyx-pink',
    label: 'Onyx Pink',
    description: 'Charcoal interface with vivid pink accents.',
    density: 'comfortable',
  },
  {
    id: 'spring-violet',
    label: 'Spring Violet',
    description: 'Fresh green workspace with violet accents.',
    density: 'comfortable',
  },
  {
    id: 'harbor-cyan',
    label: 'Harbor Cyan',
    description: 'Deep navy workspace with soft cyan accents.',
    density: 'comfortable',
  },
];

interface ThemeContextValue {
  theme: Theme;
  themeDefinition: ThemeDefinition;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'hermes',
  themeDefinition: THEMES[0],
  setTheme: () => {},
  toggleTheme: () => {},
});

function normalizeTheme(value: string | null): Theme {
  if (
    value === 'light' ||
    value === 'mono' ||
    value === 'hermes' ||
    value === 'onyx-pink' ||
    value === 'spring-violet' ||
    value === 'harbor-cyan'
  ) {
    return value;
  }
  if (value === 'dark') return 'hermes';
  return 'hermes';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('rac-theme');
    return normalizeTheme(saved);
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('rac-theme', theme);
  }, [theme]);

  function toggleTheme() {
    setTheme((current) => {
      const index = THEMES.findIndex((entry) => entry.id === current);
      return THEMES[(index + 1) % THEMES.length].id;
    });
  }

  const themeDefinition = useMemo(
    () => THEMES.find((entry) => entry.id === theme) ?? THEMES[0],
    [theme],
  );

  return (
    <ThemeContext.Provider value={{ theme, themeDefinition, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
