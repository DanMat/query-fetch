import { describe, expect, it, vi } from "vitest";
import { QueryError, query, queryJson } from "../src/index.js";

/** Build a fake fetch that records the last call and returns a canned Response. */
function fakeFetch(response: Response | ((n: number) => Response)) {
  const calls: Array<{ input: string | URL; init?: RequestInit }> = [];
  let n = 0;
  const impl = vi.fn(async (input: string | URL, init?: RequestInit) => {
    calls.push({ input, init });
    const res = typeof response === "function" ? response(n) : response;
    n += 1;
    return res;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("query", () => {
  it("sends the QUERY method with the provided body", async () => {
    const { impl, calls } = fakeFetch(new Response("ok", { status: 200 }));

    await query("https://api.test/search", {
      body: "field=value",
      contentType: "application/x-www-form-urlencoded",
      fetch: impl,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.init!.method).toBe("QUERY");
    expect(calls[0]!.init!.body).toBe("field=value");
    const headers = new Headers(calls[0]!.init!.headers);
    expect(headers.get("content-type")).toBe(
      "application/x-www-form-urlencoded",
    );
  });

  it("serializes `json` and sets application/json", async () => {
    const { impl, calls } = fakeFetch(new Response("{}", { status: 200 }));

    await query("https://api.test/search", {
      json: { filter: { status: "active" } },
      fetch: impl,
    });

    const headers = new Headers(calls[0]!.init!.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(calls[0]!.init!.body).toBe('{"filter":{"status":"active"}}');
  });

  it("sets the Accept header from a string or array", async () => {
    const { impl, calls } = fakeFetch(new Response("", { status: 200 }));

    await query("https://api.test/s", {
      json: {},
      accept: ["application/json", "application/cbor"],
      fetch: impl,
    });

    const headers = new Headers(calls[0]!.init!.headers);
    expect(headers.get("accept")).toBe("application/json, application/cbor");
  });

  it("throws QueryError when a body has no Content-Type", async () => {
    const { impl } = fakeFetch(new Response("", { status: 200 }));

    await expect(
      query("https://api.test/s", { body: "raw", fetch: impl }),
    ).rejects.toBeInstanceOf(QueryError);
  });

  it("falls back to POST on 501 with an override header", async () => {
    const { impl, calls } = fakeFetch((n) =>
      n === 0
        ? new Response("nope", { status: 501 })
        : new Response("ok", { status: 200 }),
    );

    const res = await query("https://api.test/s", {
      json: { q: 1 },
      fetch: impl,
    });

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.init!.method).toBe("QUERY");
    expect(calls[1]!.init!.method).toBe("POST");
    const fbHeaders = new Headers(calls[1]!.init!.headers);
    expect(fbHeaders.get("x-http-method-override")).toBe("QUERY");
    expect(calls[1]!.init!.body).toBe('{"q":1}');
  });

  it("does not fall back when fallbackToPost is false", async () => {
    const { impl, calls } = fakeFetch(new Response("nope", { status: 405 }));

    const res = await query("https://api.test/s", {
      json: {},
      fallbackToPost: false,
      fetch: impl,
    });

    expect(res.status).toBe(405);
    expect(calls).toHaveLength(1);
  });

  it("omits the override header when methodOverrideHeader is false", async () => {
    const { impl, calls } = fakeFetch((n) =>
      n === 0
        ? new Response("", { status: 405 })
        : new Response("", { status: 200 }),
    );

    await query("https://api.test/s", {
      json: {},
      methodOverrideHeader: false,
      fetch: impl,
    });

    const fbHeaders = new Headers(calls[1]!.init!.headers);
    expect(fbHeaders.has("x-http-method-override")).toBe(false);
  });

  it("throws QueryError when no fetch is available at all", async () => {
    const original = globalThis.fetch;
    // Simulate a runtime that provides no global fetch.
    (globalThis as { fetch?: typeof fetch }).fetch = undefined;
    try {
      await expect(
        query("https://api.test/s", { json: {} }),
      ).rejects.toBeInstanceOf(QueryError);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("queryJson", () => {
  it("parses the JSON body and returns the response", async () => {
    const { impl } = fakeFetch(
      new Response('{"total":42}', {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const { data, response } = await queryJson<{ total: number }>(
      "https://api.test/s",
      { json: {}, fetch: impl },
    );

    expect(data.total).toBe(42);
    expect(response.status).toBe(200);
  });

  it("throws QueryError on a non-2xx response", async () => {
    const { impl } = fakeFetch(new Response("boom", { status: 500 }));

    await expect(
      queryJson("https://api.test/s", { json: {}, fetch: impl }),
    ).rejects.toBeInstanceOf(QueryError);
  });
});
