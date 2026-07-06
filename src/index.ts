/**
 * @danmat/query-fetch
 *
 * A tiny, dependency-free client for the HTTP QUERY method (RFC 10008) — the
 * safe, idempotent request that carries a body like POST but caches like GET.
 *
 * @see https://www.rfc-editor.org/rfc/rfc10008
 */

/** Status codes that signal a server does not understand the QUERY method. */
const METHOD_UNSUPPORTED_STATUSES = new Set([405, 501]);

/** Statuses worth retrying for an idempotent request. */
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Default header used to tunnel the intended method when falling back to POST. */
const DEFAULT_OVERRIDE_HEADER = "X-HTTP-Method-Override";

/**
 * Error thrown when a QUERY request cannot be constructed according to the
 * requirements of RFC 10008 (e.g. a body with no `Content-Type`).
 */
export class QueryError extends Error {
  override name = "QueryError";

  constructor(message: string) {
    super(message);
    // Restore prototype chain for transpiled/ES5 targets.
    Object.setPrototypeOf(this, QueryError.prototype);
  }
}

/** Details about a failed attempt, passed to retry callbacks. */
export interface RetryContext {
  /** 1-based number of the retry about to happen (or being decided). */
  attempt: number;
  /** The response received, when the failure was an HTTP status. */
  response?: Response;
  /** The error thrown, when the failure was a network/abort error. */
  error?: unknown;
}

/** Controls automatic retries. See {@link QueryOptions.retry}. */
export interface RetryOptions {
  /** Maximum number of retries after the initial attempt. */
  retries: number;
  /** Base backoff delay in milliseconds. Default `200`. */
  minDelay?: number;
  /** Maximum backoff delay in milliseconds. Default `10000`. */
  maxDelay?: number;
  /** Exponential backoff multiplier. Default `2`. */
  factor?: number;
  /** Apply random jitter to spread retries out. Default `true`. */
  jitter?: boolean;
  /** Honor a `Retry-After` response header (e.g. on 429/503). Default `true`. */
  respectRetryAfter?: boolean;
  /**
   * Decide whether a failed attempt should be retried. By default, network
   * errors and the statuses 408/425/429/500/502/503/504 are retried, while
   * aborts are not. QUERY is idempotent, so retrying is safe.
   */
  retryOn?: (context: RetryContext) => boolean | Promise<boolean>;
  /** Called before each backoff wait, with the chosen delay. */
  onRetry?: (context: RetryContext & { delay: number }) => void;
}

/** Options for {@link query}. Extends `RequestInit` minus the fields we own. */
export interface QueryOptions extends Omit<RequestInit, "method" | "body"> {
  /**
   * The raw query body. Pair with {@link QueryOptions.contentType}. For JSON
   * payloads prefer {@link QueryOptions.json}, which sets the content type for
   * you.
   */
  body?: BodyInit | null;

  /**
   * Convenience: a value serialized to JSON and sent as
   * `application/json`. Ignored if {@link QueryOptions.body} is set.
   */
  json?: unknown;

  /**
   * MIME type of the query body. **Required** whenever a body is present —
   * RFC 10008 mandates that servers reject a QUERY with a missing or
   * inconsistent `Content-Type`. Ignored when using {@link QueryOptions.json}.
   */
  contentType?: string;

  /** Media type(s) acceptable in the response. Sets the `Accept` header. */
  accept?: string | string[];

  /**
   * Retry as `POST` when the server reports it does not support QUERY
   * (HTTP 405 or 501). Defaults to `true`.
   */
  fallbackToPost?: boolean;

  /**
   * Header name used to advertise the original method on a POST fallback so
   * that override-aware servers can still route it as a QUERY. Set to `false`
   * to disable. Defaults to `"X-HTTP-Method-Override"`.
   */
  methodOverrideHeader?: string | false;

  /**
   * Automatically retry transient failures. Pass a number for "retry N times
   * with sensible backoff", or a {@link RetryOptions} object for full control.
   * Because QUERY is idempotent, retrying is safe — unlike POST. Off unless set.
   *
   * Retries reuse a buffered body (a string, bytes, or `json`); a streaming
   * body can only be sent once and won't be retried.
   */
  retry?: number | RetryOptions;

  /**
   * A `fetch` implementation to use instead of the global. Handy for testing
   * or for runtimes that expose `fetch` on a client rather than globally.
   */
  fetch?: typeof fetch;
}

/** The result of {@link queryJson}: a parsed body plus the originating response. */
export interface QueryJsonResult<T> {
  data: T;
  response: Response;
}

interface ResolvedRetry {
  retries: number;
  minDelay: number;
  maxDelay: number;
  factor: number;
  jitter: boolean;
  respectRetryAfter: boolean;
  retryOn: (context: RetryContext) => boolean | Promise<boolean>;
  onRetry?: (context: RetryContext & { delay: number }) => void;
}

function resolveFetch(custom?: typeof fetch): typeof fetch {
  const impl = custom ?? globalThis.fetch;
  if (typeof impl !== "function") {
    throw new QueryError(
      "No fetch implementation found. Pass `fetch` in options or run on a runtime that provides a global fetch.",
    );
  }
  return impl;
}

/**
 * Build the request body and headers, enforcing RFC 10008's `Content-Type`
 * requirement. Returns the effective body so it can be reused by a fallback.
 */
function prepare(options: QueryOptions): {
  headers: Headers;
  body: BodyInit | null | undefined;
} {
  const headers = new Headers(options.headers);

  let body: BodyInit | null | undefined = options.body;

  if (body == null && options.json !== undefined) {
    body = JSON.stringify(options.json);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
  } else if (options.contentType) {
    headers.set("content-type", options.contentType);
  }

  const hasBody = body != null;
  if (hasBody && !headers.has("content-type")) {
    throw new QueryError(
      "A QUERY request with a body must set a Content-Type (RFC 10008). Pass `contentType`, use `json`, or set the header explicitly.",
    );
  }

  if (options.accept !== undefined) {
    const accept = Array.isArray(options.accept)
      ? options.accept.join(", ")
      : options.accept;
    headers.set("accept", accept);
  }

  return { headers, body };
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: string }).name === "AbortError"
  );
}

function defaultRetryOn(context: RetryContext): boolean {
  if (context.error !== undefined) return !isAbortError(context.error);
  if (context.response) return RETRYABLE_STATUSES.has(context.response.status);
  return false;
}

function resolveRetry(
  retry: number | RetryOptions | undefined,
): ResolvedRetry | null {
  if (retry === undefined) return null;
  const opts = typeof retry === "number" ? { retries: retry } : retry;
  if (!opts.retries || opts.retries < 1) return null;
  return {
    retries: opts.retries,
    minDelay: opts.minDelay ?? 200,
    maxDelay: opts.maxDelay ?? 10_000,
    factor: opts.factor ?? 2,
    jitter: opts.jitter ?? true,
    respectRetryAfter: opts.respectRetryAfter ?? true,
    retryOn: opts.retryOn ?? defaultRetryOn,
    onRetry: opts.onRetry,
  };
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - Date.now());
}

function backoffDelay(
  cfg: ResolvedRetry,
  attemptIndex: number,
  response?: Response,
): number {
  if (cfg.respectRetryAfter && response) {
    const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
    if (retryAfter !== null) return retryAfter;
  }
  const base = Math.min(
    cfg.maxDelay,
    cfg.minDelay * cfg.factor ** attemptIndex,
  );
  return cfg.jitter ? base / 2 + Math.random() * (base / 2) : base;
}

function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(abortError());
      },
      { once: true },
    );
  });
}

/**
 * Perform an HTTP QUERY request (RFC 10008).
 *
 * QUERY is safe and idempotent like GET, but carries a request body like POST,
 * making it ideal for large or structured queries that don't fit in a URL.
 *
 * Redirects — including the RFC's `303 See Other` indirect-result pattern — are
 * handled by the underlying `fetch` per the request's `redirect` mode (default
 * `"follow"`), so no special handling is needed here.
 *
 * @example
 * ```ts
 * const res = await query("https://api.example.com/search", {
 *   json: { filter: { status: "active" }, sort: "-createdAt" },
 *   accept: "application/json",
 *   retry: 3, // safe: QUERY is idempotent
 * });
 * ```
 */
export async function query(
  input: string | URL,
  options: QueryOptions = {},
): Promise<Response> {
  const doFetch = resolveFetch(options.fetch);
  const { headers, body } = prepare(options);

  const {
    fetch: _fetch,
    json: _json,
    contentType: _contentType,
    accept: _accept,
    retry: _retry,
    fallbackToPost = true,
    methodOverrideHeader = DEFAULT_OVERRIDE_HEADER,
    headers: _headers,
    body: _body,
    ...init
  } = options;

  const attempt = async (): Promise<Response> => {
    const response = await doFetch(input, {
      ...init,
      method: "QUERY",
      headers,
      body,
    });

    if (!fallbackToPost || !METHOD_UNSUPPORTED_STATUSES.has(response.status)) {
      return response;
    }

    // The server doesn't speak QUERY — retry as POST, optionally advertising
    // the original method so override-aware servers can still treat it as one.
    const fallbackHeaders = new Headers(headers);
    if (methodOverrideHeader) {
      fallbackHeaders.set(methodOverrideHeader, "QUERY");
    }

    return doFetch(input, {
      ...init,
      method: "POST",
      headers: fallbackHeaders,
      body,
    });
  };

  const retryCfg = resolveRetry(options.retry);
  if (!retryCfg) return attempt();

  const signal = init.signal ?? null;
  for (let i = 0; ; i++) {
    let response: Response | undefined;
    let caught: unknown;
    try {
      response = await attempt();
    } catch (error) {
      caught = error;
    }

    const isLastAttempt = i >= retryCfg.retries;
    const context: RetryContext = { attempt: i + 1, response, error: caught };

    if (caught !== undefined) {
      if (
        isLastAttempt ||
        isAbortError(caught) ||
        !(await retryCfg.retryOn(context))
      ) {
        throw caught;
      }
    } else if (isLastAttempt || !(await retryCfg.retryOn(context))) {
      return response as Response;
    }

    const delay = backoffDelay(retryCfg, i, response);
    retryCfg.onRetry?.({ ...context, delay });
    await sleep(delay, signal);
  }
}

/**
 * Like {@link query}, but parses the response body as JSON.
 *
 * Throws {@link QueryError} on a non-2xx response so callers don't silently
 * parse an error page.
 */
export async function queryJson<T = unknown>(
  input: string | URL,
  options: QueryOptions = {},
): Promise<QueryJsonResult<T>> {
  const response = await query(input, {
    accept: "application/json",
    ...options,
  });

  if (!response.ok) {
    throw new QueryError(
      `QUERY ${input.toString()} failed with status ${response.status} ${response.statusText}`,
    );
  }

  return { data: (await response.json()) as T, response };
}
