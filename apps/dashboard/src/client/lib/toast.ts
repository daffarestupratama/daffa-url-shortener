import { useCallback, useEffect, useRef, useState } from 'react';

const TOAST_MS = 2400;

export type ToastFn = (message: string, options?: { sticky?: boolean }) => void;

/**
 * One toast at a time, as in the design: a new message replaces the current
 * one and restarts the 2.4 second timer. Sticky messages stay, for the dev
 * state preview. Render the message with ToastView.
 */
export function useToast(): { message: string | null; toast: ToastFn } {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const toast = useCallback<ToastFn>((next, options) => {
    window.clearTimeout(timer.current);
    setMessage(next);
    if (!options?.sticky) timer.current = window.setTimeout(() => setMessage(null), TOAST_MS);
  }, []);

  return { message, toast };
}
