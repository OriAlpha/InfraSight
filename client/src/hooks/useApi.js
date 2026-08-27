import { useState, useEffect, useCallback, useRef } from 'react';

const BASE_URL = import.meta.env.VITE_API_URL || '/api';

function buildUrl(endpoint, params) {
  const url = new URL(`${BASE_URL}${endpoint}`, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.append(key, String(value));
      }
    });
  }
  return url.toString();
}

export async function fetchApi(endpoint, options = {}) {
  const { params, method = 'GET', body, ...fetchOptions } = options;
  const url = buildUrl(endpoint, params);

  const config = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...fetchOptions.headers,
    },
    ...fetchOptions,
  };

  if (body && method !== 'GET') {
    config.body = JSON.stringify(body);
  }

  const response = await fetch(url, config);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    let errMsg = '';
    if (errorData.error) {
      if (typeof errorData.error === 'object') {
        errMsg = errorData.error.message || JSON.stringify(errorData.error);
      } else {
        errMsg = errorData.error;
      }
    } else {
      errMsg = errorData.message || `Request failed with status ${response.status}`;
    }

    // Give the two responses the server can now produce a message the user can
    // act on, instead of surfacing them as an opaque failure.
    if (response.status === 401) {
      errMsg = 'Not authorised. The dashboard requires sign-in — reload the page to enter your credentials.';
    } else if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('Retry-After'), 10);
      errMsg = retryAfter > 0
        ? `Rate limit reached. Try again in ${retryAfter}s.`
        : 'Rate limit reached. Try again in a moment.';
    }

    const error = new Error(errMsg);
    error.status = response.status;
    error.details = errorData.error?.details;
    throw error;
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

export function useApi(endpoint, options = {}) {
  const { params, enabled = true, ...fetchOptions } = options;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);
  const dataRef = useRef(null);

  // Sync dataRef with current data state
  dataRef.current = data;

  const serializedParams = params ? JSON.stringify(params) : '';

  // Reset states when endpoint or parameters change to show initial skeleton loaders
  useEffect(() => {
    setData(null);
    dataRef.current = null;
    setLoading(true);
    setError(null);
  }, [endpoint, serializedParams]);

  const fetchData = useCallback(async () => {
    if (!enabled || !endpoint) {
      setLoading(false);
      return;
    }

    if (abortRef.current) {
      abortRef.current.abort();
    }

    const controller = new AbortController();
    abortRef.current = controller;

    // Only trigger full loading state if there is no current data
    if (!dataRef.current) {
      setLoading(true);
    }
    setError(null);

    try {
      const parsedParams = serializedParams ? JSON.parse(serializedParams) : undefined;
      const result = await fetchApi(endpoint, {
        params: parsedParams,
        signal: controller.signal,
        ...fetchOptions,
      });
      if (!controller.signal.aborted) {
        setData(result);
        setLoading(false);
      }
    } catch (err) {
      if (err.name !== 'AbortError' && !controller.signal.aborted) {
        setError(err.message);
        setLoading(false);
      }
    }
  }, [endpoint, serializedParams, enabled]);

  useEffect(() => {
    fetchData();
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, [fetchData]);

  const refetch = useCallback(() => {
    return fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch };
}

export default useApi;
