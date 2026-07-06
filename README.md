# @danmat/query-fetch

[![CI](https://github.com/DanMat/query-fetch/actions/workflows/ci.yml/badge.svg)](https://github.com/DanMat/query-fetch/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@danmat/query-fetch.svg)](https://www.npmjs.com/package/@danmat/query-fetch)
[![minified + gzip size](https://img.shields.io/bundlejs/size/@danmat/query-fetch)](https://bundlejs.com/?q=@danmat/query-fetch)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

A tiny, **dependency-free** client for the HTTP **QUERY** method ([RFC 10008](https://www.rfc-editor.org/rfc/rfc10008)) — the request that is *safe and idempotent like `GET`*, but *carries a body like `POST`*, and *caches like neither before it could*.

Built on native `fetch`. Works in Node 18+, Deno, Bun, Cloudflare Workers, and the browser.

```ts
import { query } from "@danmat/query-fetch";

const res = await query("https://api.example.com/search", {
  json: { filter: { status: "active" }, sort: "-createdAt", limit: 50 },
});
```

## Why QUERY?

For years you had two bad options for a search endpoint:

- **`GET` with a query string** — safe, idempotent, cacheable… but your filter blows past URL length limits and leaks into logs.
- **`POST` with a body** — room for a rich query… but it's neither safe, idempotent, nor cacheable, so proxies and clients treat it as a state change.

`QUERY` is the missing third option: a body-carrying request that intermediaries may cache and clients may safely retry. This library handles the sharp edges the spec introduces.

## Install

```sh
npm install @danmat/query-fetch
```

## What it does for you

Scripted `fetch(url, { method: "QUERY", body })` already works in modern runtimes — but the *semantics* of RFC 10008 are on you. This library covers them:

- ✅ **Enforces `Content-Type`** — the RFC requires servers to reject a QUERY whose body has no content type. We throw *before* the round-trip instead of letting you debug a `400`.
- ✅ **Transparent `POST` fallback** — servers that don't understand QUERY yet respond `405`/`501`; we automatically retry as `POST` and advertise the original method via `X-HTTP-Method-Override` so override-aware backends still route it correctly.
- ✅ **`Accept` negotiation** — pass a media type (or list) to negotiate the response format the RFC's `Accept-Query` dance is built around.
- ✅ **Redirect-safe** — the RFC's `303 See Other` indirect-result pattern is handled by `fetch`'s own redirect following; nothing surprising here.
- ✅ **Zero dependencies, fully typed, tree-shakeable**, dual ESM/CJS.

## Usage

### JSON queries

```ts
import { queryJson } from "@danmat/query-fetch";

const { data, response } = await queryJson<{ total: number }>(
  "https://api.example.com/search",
  { json: { q: "http query method" } },
);

console.log(data.total, response.headers.get("age"));
```

`queryJson` sets `Accept: application/json`, throws on a non-2xx status, and returns the parsed body alongside the raw `Response`.

### Raw bodies with an explicit content type

```ts
await query("https://api.example.com/search", {
  body: "SELECT * WHERE status = 'active'",
  contentType: "application/sql",
  accept: "application/json",
});
```

### Opt out of the POST fallback

```ts
await query(url, { json, fallbackToPost: false });
```

### Bring your own `fetch`

```ts
import { fetch as undiciFetch } from "undici";

await query(url, { json, fetch: undiciFetch });
```

## API

### `query(input, options?): Promise<Response>`

Performs a QUERY request. `options` extends `RequestInit` (so `signal`, `credentials`, `redirect`, etc. all work), minus `method` and with a richer `body`:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `body` | `BodyInit \| null` | — | Raw query body. Pair with `contentType`. |
| `json` | `unknown` | — | Value serialized to JSON; sets `application/json`. |
| `contentType` | `string` | — | MIME type of `body`. Required when a body is present. |
| `accept` | `string \| string[]` | — | Sets the `Accept` header. |
| `fallbackToPost` | `boolean` | `true` | Retry as `POST` on `405`/`501`. |
| `methodOverrideHeader` | `string \| false` | `"X-HTTP-Method-Override"` | Header advertising the original method on fallback. |
| `fetch` | `typeof fetch` | `globalThis.fetch` | Custom fetch implementation. |

### `queryJson<T>(input, options?): Promise<{ data: T; response: Response }>`

`query` + JSON parsing + a non-2xx guard.

### `QueryError`

Thrown for construction-time problems (a body without a content type, no available `fetch`) and non-2xx responses in `queryJson`.

## Caveats & status

QUERY is a **Proposed Standard** (June 2026). Two things to know:

- **CORS:** QUERY is not a CORS-safelisted method, so a cross-origin QUERY triggers a preflight. Your server must handle `OPTIONS` accordingly.
- **Spec churn:** browser-integration details (method normalization, caching) are still being ironed out in [whatwg/fetch#1938](https://github.com/whatwg/fetch/issues/1938). This library tracks runtime behavior as it ships.

## The `@danmat` QUERY suite

- **`@danmat/query-fetch`** — client for the QUERY method *(you are here)*.
- [`@danmat/accept-query`](https://github.com/DanMat/accept-query) — parse/build/negotiate the `Accept-Query` header.
- [`@danmat/query-cache`](https://github.com/DanMat/query-cache) — body-aware response caching.
- [`@danmat/query-server`](https://github.com/DanMat/query-server) — server-side request validation & negotiation.

▶️ **See them work together:** [query-suite-example](https://github.com/DanMat/query-suite-example) — a runnable stock-screener demo using all four.

## License

[MIT](./LICENSE) © Dan Matthew
