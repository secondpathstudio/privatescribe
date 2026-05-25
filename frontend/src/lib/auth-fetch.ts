/**
 * Silent token refresh (Phase 10, rest of GAP-16).
 *
 * A global `fetch` interceptor: when an authenticated request to the API comes
 * back 401, it tries the refresh token once (POST /refresh), and on success
 * re-pins the new access token and retries the original request transparently.
 * If the refresh fails, the session is truly gone — it clears auth and fires a
 * `privatescribe:auth-expired` event the auth context listens for.
 *
 * Why an interceptor (not a polling timer): /refresh `touch`es the session and
 * resets its idle timer, so refreshing proactively would defeat idle-logout.
 * Refresh must be *reactive* — only when a request the user actually made is
 * rejected for an expired access token (the session itself still alive).
 *
 * Why patch global fetch: there's no central API client and auth'd calls are
 * scattered across the app; wrapping fetch applies this everywhere without
 * touching every call site. It only acts on 401s to API_BASE that carried an
 * Authorization header, and never on /refresh or /login (no loops).
 */
import { API_BASE } from "./api";
import { clearAuth, getRefreshToken, setAccessToken } from "./token-store";

const originalFetch: typeof fetch = window.fetch.bind(window);

// One shared in-flight refresh so concurrent 401s trigger a single /refresh.
let refreshing: Promise<string | null> | null = null;

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  return String(input);
}

function headerValue(init: RequestInit | undefined, name: string): string | undefined {
  const h = init?.headers;
  if (!h) return undefined;
  const lower = name.toLowerCase();
  if (h instanceof Headers) return h.get(name) ?? undefined;
  if (Array.isArray(h)) return h.find(([k]) => k.toLowerCase() === lower)?.[1];
  for (const k of Object.keys(h)) {
    if (k.toLowerCase() === lower) return (h as Record<string, string>)[k];
  }
  return undefined;
}

function withAuthHeader(init: RequestInit | undefined, token: string): RequestInit {
  const next: RequestInit = { ...(init ?? {}) };
  const value = `Bearer ${token}`;
  const h = next.headers;
  if (h instanceof Headers) {
    const nh = new Headers(h);
    nh.set("Authorization", value);
    next.headers = nh;
  } else if (Array.isArray(h)) {
    next.headers = [...h.filter(([k]) => k.toLowerCase() !== "authorization"), ["Authorization", value]];
  } else {
    next.headers = { ...(h as Record<string, string> | undefined), Authorization: value };
  }
  return next;
}

async function doRefresh(): Promise<string | null> {
  const rt = getRefreshToken();
  if (!rt) return null;
  try {
    const res = await originalFetch(`${API_BASE}/refresh`, {
      method: "POST",
      headers: { Authorization: `Bearer ${rt}` },
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    if (typeof data.access_token === "string") {
      setAccessToken(data.access_token);
      return data.access_token;
    }
    return null;
  } catch {
    return null;
  }
}

/** Install the interceptor once, before the app makes any requests. */
export function installAuthFetch(): void {
  if ((window as unknown as { __psAuthFetch?: boolean }).__psAuthFetch) return;
  (window as unknown as { __psAuthFetch?: boolean }).__psAuthFetch = true;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const res = await originalFetch(input, init);
    try {
      if (res.status !== 401) return res;
      const url = urlOf(input);
      // Only our API, only requests that carried a token, never the auth
      // endpoints themselves, and never a request we already retried.
      if (!url.startsWith(API_BASE)) return res;
      if (url.includes("/refresh") || url.includes("/api/login")) return res;
      if (!headerValue(init, "Authorization")) return res;
      if ((init as { __psRetried?: boolean } | undefined)?.__psRetried) return res;

      refreshing = refreshing ?? doRefresh();
      const newToken = await refreshing;
      refreshing = null;

      if (!newToken) {
        // Session is gone (revoked / idle-expired / deactivated). Sign out.
        clearAuth();
        window.dispatchEvent(new CustomEvent("privatescribe:auth-expired"));
        return res;
      }

      const retryInit = withAuthHeader(init, newToken) as RequestInit & { __psRetried?: boolean };
      retryInit.__psRetried = true;
      return originalFetch(url, retryInit);
    } catch {
      // Never let the interceptor break a request — fall back to the response.
      return res;
    }
  };
}
