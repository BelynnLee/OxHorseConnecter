import { useCallback, useEffect, useRef } from 'react';

export function useWorkbenchTimers() {
  const timersRef = useRef<number[]>([]);
  const runtimeUpdateTimerRef = useRef<number>();

  const schedule = useCallback((callback: () => void, delayMs: number) => {
    const timer = window.setTimeout(() => {
      timersRef.current = timersRef.current.filter((item) => item !== timer);
      callback();
    }, delayMs);
    timersRef.current.push(timer);
  }, []);

  const clearScheduled = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
  }, []);

  const clearRuntimeUpdate = useCallback(() => {
    if (runtimeUpdateTimerRef.current === undefined) return;
    window.clearTimeout(runtimeUpdateTimerRef.current);
    runtimeUpdateTimerRef.current = undefined;
  }, []);

  const scheduleRuntimeUpdate = useCallback(
    (callback: () => void, delayMs: number) => {
      clearRuntimeUpdate();
      runtimeUpdateTimerRef.current = window.setTimeout(() => {
        runtimeUpdateTimerRef.current = undefined;
        callback();
      }, delayMs);
    },
    [clearRuntimeUpdate]
  );

  useEffect(() => {
    return () => {
      clearScheduled();
      clearRuntimeUpdate();
    };
  }, [clearRuntimeUpdate, clearScheduled]);

  return {
    schedule,
    clearScheduled,
    clearRuntimeUpdate,
    scheduleRuntimeUpdate,
  };
}
