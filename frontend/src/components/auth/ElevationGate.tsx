import { useState } from "react";
import { Link } from "react-router";
import { useAuth } from "@/context/auth-context";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import NeoButton from "@/components/neo/neo-button";

/**
 * Step-up gate for no-login (kiosk) mode. The app auto-signed-in without a
 * password, so the admin console stays locked until the password is re-entered
 * — auth.elevate() swaps the kiosk token for a full one, which makes
 * RequireAdmin re-validate and render the real admin content. The backend
 * enforces the same gate (require_admin rejects kiosk tokens), so this modal
 * can't be bypassed by hitting the API directly.
 */
export default function ElevationGate() {
  const auth = useAuth();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setSubmitting(true);
    setError(null);
    try {
      await auth.elevate(password);
      // Success flips auth.token; RequireAdmin re-validates and shows admin.
    } catch (err: any) {
      setError(err?.message ?? "Could not verify password");
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-16">
      <div className="border-2 border-black bg-white p-6 space-y-4">
        <div>
          <h1 className="text-2xl font-black">Admin access</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            This device skips the login screen, so admin settings stay locked.
            Re-enter your password to continue.
          </p>
        </div>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <Label htmlFor="elevate-password" className="font-black">PASSWORD</Label>
            <PasswordInput
              id="elevate-password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="flex items-center gap-3 pt-1">
            <NeoButton
              label={submitting ? "Verifying..." : "Unlock admin"}
              backgroundColor="#fd3777"
              textColor="#ffffff"
              type="submit"
            />
            <Link to="/notes" className="text-sm underline text-muted-foreground">
              Back to notes
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
