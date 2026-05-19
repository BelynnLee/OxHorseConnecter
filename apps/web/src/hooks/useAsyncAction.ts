import { useCallback, useRef, useState } from 'react';
import { getErrorMessage } from '../lib/format.ts';

interface UseAsyncActionOptions {
  /** Default error message when the thrown value is not an Error or has no message. */
  errorFallback?: string;
  /** Default success notice when the action resolves without returning a string. */
  successMessage?: string;
}

export interface UseAsyncAction {
  /** Identifier of the in-flight action; '' when idle. */
  busy: string;
  /** True when any action is in flight. */
  isBusy: boolean;
  /** Last error message; '' when none. */
  error: string;
  /** Last success notice; '' when none. */
  notice: string;
  /** Replace the current error message. */
  setError: (message: string) => void;
  /** Replace the current notice message. */
  setNotice: (message: string) => void;
  /** Clear both error and notice. */
  clear: () => void;
  /**
   * Execute an async action with automatic busy / error / notice state.
   * Returns the action's resolved value, or undefined if it threw.
   * If the action returns a string, that string becomes the notice;
   * otherwise the optional `successMessage` is used.
   */
  run: <T>(
    label: string,
    action: () => Promise<T>,
    options?: { successMessage?: string; errorFallback?: string },
  ) => Promise<T | undefined>;
}

/**
 * Centralizes the "set busy / try / catch / set notice / set error" boilerplate
 * found across pages. A single hook instance can run multiple actions
 * sequentially (the latest `label` wins; concurrent calls overwrite `busy`).
 */
export function useAsyncAction(options: UseAsyncActionOptions = {}): UseAsyncAction {
  const { errorFallback = 'Request failed', successMessage = '' } = options;
  const [busy, setBusy] = useState('');
  const [error, setErrorState] = useState('');
  const [notice, setNoticeState] = useState('');

  const optionsRef = useRef({ errorFallback, successMessage });
  optionsRef.current = { errorFallback, successMessage };

  const setError = useCallback((message: string) => setErrorState(message), []);
  const setNotice = useCallback((message: string) => setNoticeState(message), []);
  const clear = useCallback(() => {
    setErrorState('');
    setNoticeState('');
  }, []);

  const run = useCallback(
    async <T,>(
      label: string,
      action: () => Promise<T>,
      callOptions?: { successMessage?: string; errorFallback?: string },
    ): Promise<T | undefined> => {
      const { errorFallback: fallbackDefault, successMessage: successDefault } = optionsRef.current;
      setBusy(label);
      setErrorState('');
      setNoticeState('');
      try {
        const result = await action();
        const fallbackNotice = callOptions?.successMessage ?? successDefault;
        if (typeof result === 'string' && result) {
          setNoticeState(result);
        } else if (fallbackNotice) {
          setNoticeState(fallbackNotice);
        }
        return result;
      } catch (err) {
        setErrorState(getErrorMessage(err, callOptions?.errorFallback ?? fallbackDefault));
        return undefined;
      } finally {
        setBusy('');
      }
    },
    [],
  );

  return {
    busy,
    isBusy: busy !== '',
    error,
    notice,
    setError,
    setNotice,
    clear,
    run,
  };
}
