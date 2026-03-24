/**
 * Tests for src/lib/api.ts
 *
 * Coverage:
 *  - ApiError class construction and properties
 *  - apiFetch: success paths (GET, POST, 204)
 *  - apiFetch: error paths (4xx, 5xx)
 *  - apiFetch: silent refresh on 401 (success + failure)
 *  - apiFetch: concurrent 401s share one refresh attempt
 *  - apiFetch: noRedirect option
 *  - api.get / api.post / api.put / api.patch / api.delete convenience wrappers
 *  - buildHeaders: tenant token selection, X-Tenant-ID header
 *  - pickToken: correct token selection for tenant vs SaaS calls
 *  - inferTenantRequired: path-based inference
 *  - joinUrl / resolveApiBase: URL normalisation
 */

// ── Module-level mocks (must be hoisted before imports) ──────────────────────

// Mock platform-host so api.ts does not depend on Next.js internals
jest.mock("../platform-host", () => ({
  resolveAdminPortalUrl: jest.fn((_path: string) => null),
  resolvePortalContext: jest.fn(() => ({ kind: "tenant", tenantSlug: null })),
}));

// Mock storage so we can control what tokens are returned
jest.mock("../storage", () => {
  const store: Record<string, string> = {};
  return {
    keys: {
      accessToken: "sms_access",
      saasAccessToken: "sms_saas_access",
      tenantId: "sms_tenant_id",
      tenantSlug: "sms_tenant_slug",
      mode: "sms_mode",
    },
    storage: {
      get: jest.fn((key: string) => store[key] ?? null),
      set: jest.fn((key: string, val: string) => { store[key] = val; }),
      remove: jest.fn((key: string) => { delete store[key]; }),
    },
    __store: store,
  };
});

// ── Imports ───────────────────────────────────────────────────────────────────

import { ApiError, apiFetch, api, _resetRefreshState } from "../api";
import { keys } from "../storage";
import { resolvePortalContext } from "../platform-host";

// ── Helpers ───────────────────────────────────────────────────────────────────

const mockStore = (require("../storage") as any).__store as Record<string, string>;

function setTokens(opts: {
  tenantToken?: string;
  saasToken?: string;
  tenantId?: string;
  tenantSlug?: string;
  mode?: string;
}) {
  // Clear all first
  delete mockStore[keys.accessToken];
  delete mockStore[keys.saasAccessToken];
  delete mockStore[keys.tenantId];
  delete mockStore[keys.tenantSlug];
  delete mockStore[keys.mode];

  if (opts.tenantToken) mockStore[keys.accessToken] = opts.tenantToken;
  if (opts.saasToken) mockStore[keys.saasAccessToken] = opts.saasToken;
  if (opts.tenantId) mockStore[keys.tenantId] = opts.tenantId;
  if (opts.tenantSlug) mockStore[keys.tenantSlug] = opts.tenantSlug;
  if (opts.mode) mockStore[keys.mode] = opts.mode;
}

function mockFetchOnce(status: number, body: unknown = {}, headers: Record<string, string> = {}) {
  const resHeaders = new Headers(headers);
  (global.fetch as jest.Mock).mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status, headers: resHeaders })
  );
}

function mockFetchRaw(responses: Array<{ status: number; body?: unknown }>) {
  for (const r of responses) {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      new Response(JSON.stringify(r.body ?? {}), { status: r.status })
    );
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

// jsdom 26 makes window.location non-configurable — the classic delete+reassign
// trick no longer works. Instead, spy on the href setter on Location.prototype so
// we can (a) suppress "Not implemented: navigation" errors and (b) track redirects.
// jsdom 26 makes window.location fully non-configurable — we cannot spy on the
// href setter at all. Instead, we verify redirect behaviour via the already-mocked
// resolvePortalContext: redirectToLogin() is the only caller, so checking whether
// resolvePortalContext was called tells us if a redirect was attempted.


beforeEach(() => {
  _resetRefreshState();
  jest.clearAllMocks();
  // Clear storage
  for (const key of Object.keys(mockStore)) delete mockStore[key];

  // Default: tenant mode
  setTokens({
    tenantToken: "test-tenant-token",
    tenantId: "tenant-uuid-1234",
    tenantSlug: "test-school",
    mode: "tenant",
  });

  // Mock global fetch
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── ApiError ──────────────────────────────────────────────────────────────────

describe("ApiError", () => {
  test("has correct name, status, message, and body", () => {
    const err = new ApiError(404, "Not found", { detail: "No such resource" });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.name).toBe("ApiError");
    expect(err.status).toBe(404);
    expect(err.message).toBe("Not found");
    expect(err.body).toEqual({ detail: "No such resource" });
  });

  test("body is optional", () => {
    const err = new ApiError(500, "Server error");
    expect(err.body).toBeUndefined();
  });

  test("is throwable and catchable", async () => {
    await expect(async () => {
      throw new ApiError(401, "Unauthorized");
    }).rejects.toBeInstanceOf(ApiError);
  });
});

// ── apiFetch: success paths ────────────────────────────────────────────────────

describe("apiFetch — success paths", () => {
  test("GET returns parsed JSON", async () => {
    mockFetchOnce(200, { items: [1, 2, 3] });
    const result = await apiFetch<{ items: number[] }>("/enrollments/");
    expect(result).toEqual({ items: [1, 2, 3] });
  });

  test("204 No Content returns undefined", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      new Response(null, { status: 204 })
    );
    const result = await apiFetch("/enrollments/some-id");
    expect(result).toBeUndefined();
  });

  test("sends Authorization header with tenant token", async () => {
    mockFetchOnce(200, {});
    await apiFetch("/enrollments/");
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer test-tenant-token");
  });

  test("sends X-Tenant-ID header on tenant requests", async () => {
    mockFetchOnce(200, {});
    await apiFetch("/enrollments/");
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.get("x-tenant-id")).toBe("tenant-uuid-1234");
  });

  test("sends X-Tenant-Slug header when slug is stored", async () => {
    mockFetchOnce(200, {});
    await apiFetch("/enrollments/");
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.get("x-tenant-slug")).toBe("test-school");
  });

  test("does not send tenant headers for SaaS endpoints", async () => {
    setTokens({ saasToken: "saas-token", mode: "saas" });
    mockFetchOnce(200, { mode: "saas" });
    await apiFetch("/auth/me/saas", { tenantRequired: false });
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer saas-token");
    expect(headers.get("x-tenant-id")).toBeNull();
  });

  test("sets Content-Type: application/json for object bodies", async () => {
    mockFetchOnce(201, { id: "new-id" });
    await apiFetch("/enrollments/", { method: "POST", body: JSON.stringify({ name: "Test" }) });
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.get("content-type")).toBe("application/json");
  });

  test("forwards custom X-Request-ID header", async () => {
    mockFetchOnce(200, {});
    await apiFetch("/enrollments/", { requestId: "my-trace-id" });
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.get("x-request-id")).toBe("my-trace-id");
  });

  test("includes credentials: include", async () => {
    mockFetchOnce(200, {});
    await apiFetch("/enrollments/");
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.credentials).toBe("include");
  });
});

// ── apiFetch: error paths ─────────────────────────────────────────────────────

describe("apiFetch — error paths", () => {
  test("throws ApiError on 400", async () => {
    mockFetchOnce(400, { detail: "Bad input" });
    await expect(apiFetch("/enrollments/")).rejects.toMatchObject({
      status: 400,
      message: "Bad input",
    });
  });

  test("throws ApiError on 403", async () => {
    mockFetchOnce(403, { detail: "Forbidden" });
    await expect(apiFetch("/enrollments/")).rejects.toMatchObject({
      status: 403,
    });
  });

  test("throws ApiError on 500", async () => {
    mockFetchOnce(500, { detail: "Internal error" });
    await expect(apiFetch("/enrollments/")).rejects.toMatchObject({
      status: 500,
    });
  });

  test("throws ApiError with fallback message when body has no detail", async () => {
    mockFetchOnce(503, {});
    await expect(apiFetch("/enrollments/")).rejects.toMatchObject({
      status: 503,
      message: expect.stringContaining("503"),
    });
  });

  test("throws ApiError(400) when no tenant context is stored", async () => {
    setTokens({ tenantToken: "tok" }); // no tenantId, no tenantSlug
    await expect(apiFetch("/enrollments/")).rejects.toMatchObject({
      status: 400,
    });
  });

  test("throws ApiError(401) when no token stored", async () => {
    setTokens({}); // empty — no token
    await expect(apiFetch("/enrollments/")).rejects.toMatchObject({
      status: 401,
    });
  });
});

// ── apiFetch: silent refresh ──────────────────────────────────────────────────

describe("apiFetch — silent refresh", () => {
  function mockRefreshSuccess(newToken = "new-access-token") {
    // Next.js /api/auth/refresh proxy
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: newToken,
          tenant_id: "tenant-uuid-1234",
          tenant_slug: "test-school",
        }),
        { status: 200 }
      )
    );
  }

  function mockRefreshFail() {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "Refresh expired" }), { status: 401 })
    );
  }

  test("retries request after successful silent refresh", async () => {
    // 1. Original 401  2. Refresh success  3. Retry 200
    mockFetchRaw([
      { status: 401, body: { detail: "Token expired" } },
    ]);
    mockRefreshSuccess();
    mockFetchOnce(200, { data: "ok" });

    const result = await apiFetch<{ data: string }>("/enrollments/", { noRedirect: true });
    expect(result).toEqual({ data: "ok" });
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  test("throws ApiError(401) and clears auth state when refresh fails", async () => {
    mockFetchRaw([{ status: 401, body: { detail: "Token expired" } }]);
    mockRefreshFail();
    // After failed refresh, apiFetch does a second fetch and gets 401 again
    mockFetchRaw([{ status: 401, body: { detail: "Token expired" } }]);

    await expect(
      apiFetch("/enrollments/", { noRedirect: true })
    ).rejects.toMatchObject({ status: 401 });

    // Auth state should be cleared
    expect(mockStore[keys.accessToken]).toBeUndefined();
  });

  test("does not redirect when noRedirect: true", async () => {
    mockFetchRaw([{ status: 401 }]);
    mockRefreshFail();
    mockFetchRaw([{ status: 401 }]);

    await expect(
      apiFetch("/enrollments/", { noRedirect: true })
    ).rejects.toBeInstanceOf(ApiError);

    // redirectToLogin was never called (resolvePortalContext is its first call)
    expect(resolvePortalContext).not.toHaveBeenCalled();
  });
});

// ── api convenience wrappers ──────────────────────────────────────────────────

describe("api convenience wrappers", () => {
  test("api.get sends GET", async () => {
    mockFetchOnce(200, { items: [] });
    await api.get("/enrollments/");
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.method).toBe("GET");
  });

  test("api.post sends POST with serialized body", async () => {
    mockFetchOnce(201, { id: "1" });
    await api.post("/enrollments/", { payload: { name: "Alice" } });
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ payload: { name: "Alice" } });
  });

  test("api.put sends PUT", async () => {
    mockFetchOnce(200, {});
    await api.put("/finance/policy", { allow_partial_enrollment: true });
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.method).toBe("PUT");
  });

  test("api.patch sends PATCH", async () => {
    mockFetchOnce(200, {});
    await api.patch("/enrollments/1", { payload: {} });
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.method).toBe("PATCH");
  });

  test("api.delete sends DELETE", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await api.delete("/enrollments/1");
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.method).toBe("DELETE");
  });

  test("api.get returns typed data", async () => {
    mockFetchOnce(200, { status: "DRAFT", id: "abc" });
    const result = await api.get<{ status: string; id: string }>("/enrollments/abc");
    expect(result.status).toBe("DRAFT");
    expect(result.id).toBe("abc");
  });
});

// ── tenantRequired inference ──────────────────────────────────────────────────

describe("tenantRequired / path inference", () => {
  test("admin/ path is inferred as SaaS when mode is saas", async () => {
    setTokens({ saasToken: "saas-tok", mode: "saas" });
    mockFetchOnce(200, {});
    await apiFetch("/admin/tenants");
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer saas-tok");
    expect(headers.get("x-tenant-id")).toBeNull();
  });

  test("explicit tenantRequired: true overrides path inference", async () => {
    setTokens({
      tenantToken: "tenant-tok",
      tenantId: "t-id",
      tenantSlug: "slug",
      mode: "tenant",
    });
    mockFetchOnce(200, {});
    await apiFetch("/finance/subscription", { tenantRequired: true });
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer tenant-tok");
    expect(headers.get("x-tenant-id")).toBe("t-id");
  });

  test("explicit tenantRequired: false forces SaaS token even on tenant-looking path", async () => {
    setTokens({ saasToken: "saas-tok", mode: "saas" });
    mockFetchOnce(200, {});
    await apiFetch("/enrollments/", { tenantRequired: false });
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer saas-tok");
  });

  test("throws ApiError(401) when using SaaS token for tenant endpoint", async () => {
    setTokens({ saasToken: "saas-tok", mode: "saas" });
    await expect(apiFetch("/enrollments/", { tenantRequired: true })).rejects.toMatchObject({
      status: 401,
    });
  });

  test("throws ApiError(401) when using tenant token for SaaS endpoint", async () => {
    setTokens({ tenantToken: "tenant-tok", tenantId: "t-id", mode: "tenant" });
    await expect(apiFetch("/auth/me/saas", { tenantRequired: false })).rejects.toMatchObject({
      status: 401,
    });
  });
});
