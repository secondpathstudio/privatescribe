import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { API_BASE } from "@/lib/api";
import LoginForm from "@/components/login-form";
import SetupForm from "@/components/setup-form";
import { useAuth } from "@/context/auth-context";

export default function Login() {
  const auth = useAuth();
  // null = haven't checked yet (avoid flashing the wrong form). false = login.
  // true = first-run setup needed.
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/setup/status`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setNeedsSetup(!!d.needs_setup);
      })
      .catch(() => {
        // Probe failed — fall back to login. The user can still surface the
        // real error by trying to sign in.
        if (!cancelled) setNeedsSetup(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Client-side redirect — preserves in-memory state (notably the pending
  // backup-key modal) instead of doing a full page reload that wipes it.
  if (auth.token) {
    // A just-created admin (needsSetup is still true on this screen) goes
    // through the onboarding wizard first; everyone else lands on their notes.
    return <Navigate to={needsSetup ? "/welcome" : "/notes"} replace />;
  }

  // Brief blank while we check setup state. Fast (one localhost roundtrip).
  if (needsSetup === null) return null;

  return (
    <div className="max-w-screen-lg mx-auto px-4 py-10">
      {needsSetup ? <SetupForm /> : <LoginForm />}
    </div>
  );
}
