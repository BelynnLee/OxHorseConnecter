import { useEffect, useState } from 'react';

export function usePersistentBoolean(key: string, defaultValue = false) {
  const [value, setValue] = useState<boolean>(() => {
    if (typeof window === 'undefined') return defaultValue;
    const stored = window.localStorage.getItem(key);
    if (stored === null) return defaultValue;
    return stored === '1';
  });

  useEffect(() => {
    window.localStorage.setItem(key, value ? '1' : '0');
  }, [key, value]);

  return [value, setValue] as const;
}
