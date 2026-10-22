'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api';

interface FetchState<T> {
  data: T | null;
  error: string | null;
  isLoading: boolean;
}

/**
 * Small data-fetching hook: runs `fetcher` whenever `deps` change, guards
 * against setting state after unmount, and exposes a manual `reload`.
 */
export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[] = [], enabled = true) {
  const [state, setState] = useState<FetchState<T>>({ data: null, error: null, isLoading: enabled });
  const mounted = useRef(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    if (!enabled) return;
    setState((s) => ({ ...s, isLoading: true, error: null }));

    try {
      const data = await fetcherRef.current();
      if (mounted.current) setState({ data, error: null, isLoading: false });
    } catch (err) {
      if (!mounted.current) return;
      const message =
        err instanceof ApiError ? err.message : 'Something went wrong while loading this data.';
      setState({ data: null, error: message, isLoading: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  useEffect(() => {
    run();
  }, [run]);

  return { ...state, reload: run, setData: (data: T) => setState((s) => ({ ...s, data })) };
}

/** Debounces a rapidly changing value, e.g. a search box. */
export function useDebounced<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
