import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { API_BASE } from "@/lib/api";
import LoginForm from "@/components/login-form";
import SetupForm from "@/components/setup-form";
import ServerSetupWizard from "@/components/server/ServerSetupWizard";
import { useAuth } from "@/context/auth-context";
import { isAdmin } from "@/lib/roles";

export default function Login() {
  const auth = useAuth();
  // null = haven't checked yet (avoid flashing the wrong form). false = login.
  // true = first-run setup needed.
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  // Whether the backend is in no-login mode — the auth context is auto-signing
  // us in, so we show a brief "Starting…" state instead of the password form.
  const [noLogin, setNoLogin] = useState(false);
  // Lets the user bail out of the auto-login wait and sign in by hand (e.g. as
  // a different user, or if auto-login is misconfigured).
  const [forceManual, setForceManual] = useState(false);
  // First-run path in the desktop app: 'choose' shows the standalone-vs-server
  // wizard; 'standalone'/'server' pick the matching setup form. The web build
  // (no window.electron.server) skips straight to the standalone form.
  const [setupPath, setSetupPath] = useState<"choose" | "standalone" | "server">("choose");

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/setup/status`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setNeedsSetup(!!d.needs_setup);
        setNoLogin(!!d.no_login);
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
    // A just-created admin (needsSetup still true here) goes through the full
    // setup wizard; a new non-admin user gets the lighter intro; everyone
    // else lands on their notes.
    if (needsSetup) return <Navigate to="/welcome" replace />;
    if (auth.user && !isAdmin(auth.user.role) && !auth.user.hasOnboarded) {
      return <Navigate to="/getting-started" replace />;
    }
    return <Navigate to="/notes" replace />;
  }

  // Brief blank while we check setup state. Fast (one localhost roundtrip).
  if (needsSetup === null) return null;

  // No-login mode: the auth context is fetching a kiosk token in the
  // background, which will flip auth.token and redirect above. Show a brief
  // "Starting…" state rather than the password form, with an escape hatch in
  // case the user wants to sign in by hand (or auto-login is misconfigured).
  if (!needsSetup && noLogin && !forceManual) {
    return (
      <div className="max-w-screen-lg mx-auto px-4 py-10 text-center space-y-4">
        <p className="text-lg font-black">Starting…</p>
        <button
          type="button"
          onClick={() => setForceManual(true)}
          className="text-sm underline text-muted-foreground"
        >
          Sign in with a password instead
        </button>
      </div>
    );
  }

  // First-run flow. Once the app is already in server mode (relaunched after a
  // server install), go straight to the org-less super-admin setup against the
  // daemon. Otherwise, in the desktop app, offer the standalone-vs-server
  // choice; the web build (no server bridge) goes straight to standalone setup.
  const isServerMode = window.electron?.mode === "server";
  const canChooseServer = !!window.electron?.server && !isServerMode;

  let setupContent;
  if (!needsSetup) {
    setupContent = <LoginForm />;
  } else if (isServerMode) {
    setupContent = <SetupForm serverMode />;
  } else if (canChooseServer && setupPath === "choose") {
    setupContent = (
      <ServerSetupWizard
        onStandalone={() => setSetupPath("standalone")}
        onServerReady={() => setSetupPath("server")}
      />
    );
  } else {
    setupContent = <SetupForm serverMode={setupPath === "server"} />;
  }

  return <div className="max-w-screen-lg mx-auto px-4 py-10">{setupContent}</div>;
}
