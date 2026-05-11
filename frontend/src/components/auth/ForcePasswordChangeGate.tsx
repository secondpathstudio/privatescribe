import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { useAuth } from "@/context/auth-context";

/**
 * Mounted inside the root layout. When the signed-in user has been flagged for
 * a password change (admin reset), this gate keeps redirecting them back to
 * /account?forced=1 if they try to navigate anywhere else. Login and signup
 * routes are exempt so a forced user can still log out and back in.
 *
 * Backend doesn't currently enforce the flag on other endpoints — this is the
 * UX guardrail. A determined client can still call the API directly with their
 * token; that's a Phase 2 hardening, not a Phase 1 blocker.
 */
const EXEMPT_PREFIXES = ["/account", "/login", "/signup"];

export default function ForcePasswordChangeGate() {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!auth.user?.forcePasswordChange) return;
    const onExempt = EXEMPT_PREFIXES.some((p) => location.pathname.startsWith(p));
    if (!onExempt) {
      navigate("/account?forced=1", { replace: true });
    }
  }, [auth.user?.forcePasswordChange, location.pathname, navigate]);

  return null;
}
