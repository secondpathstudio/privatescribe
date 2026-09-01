/**
 * Session holds — keep the login alive during long hands-off clinical work.
 *
 * The idle timeout (frontend `IdleLogout` + the backend per-request guard)
 * counts only user input and authenticated requests as activity. A recording
 * consult produces neither: with the live-transcript preview off, the app
 * makes zero API calls for the entire recording, so a consult longer than the
 * idle window used to end in a "signed out due to inactivity" 401 and the
 * loss of the in-memory audio.
 *
 * A *hold* marks a long-running operation (an active recording, or the
 * transcribe → format → save pipeline) as genuine activity:
 *   - `IdleLogout` re-arms instead of logging out while any hold is open, and
 *   - a keepalive ping hits the API every 2 minutes so the server-side
 *     session's `last_active_at` keeps advancing (its touch is throttled to
 *     once per 60s, so pinging faster buys nothing).
 *
 * This does not defeat idle-logout's purpose — the ping only runs while the
 * user is mid-consult or the app is doing work they asked for; a truly idle,
 * signed-in app still times out on schedule.
 */
import { useEffect } from "react";
import { API_BASE } from "./api";
import { getAccessToken } from "./token-store";

const PING_INTERVAL_MS = 2 * 60 * 1000;

let holds = 0;
let pingTimer: number | null = null;

function ping(): void {
  const token = getAccessToken();
  if (!token) return;
  // Any authenticated request bumps the server session; validateToken is the
  // cheapest endpoint we have. Failures are ignored — a dead session surfaces
  // through the auth-fetch interceptor's normal expired-session handling.
  void fetch(`${API_BASE}/api/validateToken`, {
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => undefined);
}

/** Open a hold; returns a release function (idempotent). */
export function acquireSessionHold(): () => void {
  holds += 1;
  if (holds === 1 && pingTimer === null) {
    // Ping immediately — the hold may open with the idle window nearly spent.
    ping();
    pingTimer = window.setInterval(ping, PING_INTERVAL_MS);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds = Math.max(0, holds - 1);
    if (holds === 0 && pingTimer !== null) {
      window.clearInterval(pingTimer);
      pingTimer = null;
    }
  };
}

/** True while any long-running operation holds the session open. */
export function isSessionHeld(): boolean {
  return holds > 0;
}

/** React hook: hold the session open while `active` is true. */
export function useSessionHold(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    return acquireSessionHold();
  }, [active]);
}
