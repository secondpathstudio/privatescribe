import { useEffect, useRef } from "react";
import { useAuth } from "@/context/auth-context";
import { isSessionHeld } from "@/lib/session-hold";

// Browser events that count as the user still being present.
const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
  "wheel",
];

// Re-arming the timer on every mousemove is wasteful — coalesce activity into
// at most one re-arm per this many milliseconds.
const REARM_THROTTLE_MS = 5000;

/**
 * Auto-logout on inactivity. Mounted once in the root layout.
 *
 * When the signed-in user has an idle timeout configured (the admin setting,
 * carried on the user object as `idleTimeoutMinutes`), this arms a timer that
 * logs the user out after that many minutes with no input; any input re-arms
 * it. The backend enforces the same timeout independently on every request —
 * this is the proactive UX half, so the user lands back on the login screen
 * at the timeout instead of discovering it on their next click.
 *
 * A session hold (an active recording, or a running transcription pipeline —
 * see lib/session-hold.ts) counts as activity even though it produces no
 * input events: logging out mid-recording unmounts the recorder and destroys
 * the not-yet-uploaded audio. While a hold is open the timer re-arms instead
 * of firing.
 */
export default function IdleLogout() {
  const auth = useAuth();
  const timerRef = useRef<number | null>(null);
  const lastRearmRef = useRef(0);
  // Hold logout in a ref so the effect doesn't depend on auth's identity
  // (which changes on every provider render).
  const logoutRef = useRef(auth.logout);
  logoutRef.current = auth.logout;

  const minutes = auth.user?.idleTimeoutMinutes ?? 0;
  const signedIn = !!auth.token && !!auth.user;

  useEffect(() => {
    // Nothing to enforce when signed out or the timeout is disabled (0).
    if (!signedIn || minutes <= 0) return;

    const timeoutMs = minutes * 60 * 1000;

    const arm = () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        // Mid-recording / mid-pipeline is not idle — defer, don't log out.
        if (isSessionHeld()) {
          arm();
          return;
        }
        logoutRef.current();
      }, timeoutMs);
    };

    const onActivity = () => {
      const now = Date.now();
      if (now - lastRearmRef.current < REARM_THROTTLE_MS) return;
      lastRearmRef.current = now;
      arm();
    };

    arm();
    ACTIVITY_EVENTS.forEach((e) =>
      window.addEventListener(e, onActivity, { passive: true })
    );
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
    };
  }, [signedIn, minutes]);

  return null;
}
