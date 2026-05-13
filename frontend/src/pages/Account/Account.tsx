import { API_BASE } from "@/lib/api";
import { FormEvent, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useAuth } from "@/context/auth-context";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import NeoButton from "@/components/neo/neo-button";

const MIN_LEN = 8;

export default function Account() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const forced = params.get("forced") === "1" || !!auth.user?.forcePasswordChange;

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword.length < MIN_LEN) {
      setError(`New password must be at least ${MIN_LEN} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }
    if (newPassword === currentPassword) {
      setError("New password must differ from your current password.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/me/change-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Server error ${res.status}`);
        return;
      }
      // Clear the forced flag locally so the user is no longer trapped.
      auth.updateUser({ forcePasswordChange: false });
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      // If they were forced here, drop them on the home page after a beat.
      if (forced) setTimeout(() => navigate("/"), 1200);
    } catch (e: any) {
      setError(e.message ?? "Network error");
    } finally {
      setSubmitting(false);
    }
  };

  if (!auth.user) return null;

  return (
    <div className="max-w-screen-md mx-auto px-4 py-10 space-y-6">
      <h1 className="text-4xl font-black">Account</h1>

      {forced && !success && (
        <div className="border-[3px] border-black bg-[#ffff00] p-4 shadow-[4px_4px_0_0_#000]">
          <p className="font-black uppercase tracking-wide text-sm">
            Password change required
          </p>
          <p className="text-sm mt-1">
            An admin reset your password. Choose a new one before continuing.
          </p>
        </div>
      )}

      <section className="border-2 border-black bg-white p-6">
        <h2 className="text-xl font-black mb-1">Change password</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Signed in as <strong>{auth.user.email}</strong>.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4 max-w-sm">
          <div>
            <Label htmlFor="current-password" className="font-black">
              Current password
            </Label>
            <Input
              id="current-password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              autoFocus
              required
            />
          </div>
          <div>
            <Label htmlFor="new-password" className="font-black">
              New password
            </Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
            <p className="text-xs text-muted-foreground mt-1">
              At least {MIN_LEN} characters.
            </p>
          </div>
          <div>
            <Label htmlFor="confirm-password" className="font-black">
              Confirm new password
            </Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}
          {success && (
            <p className="text-green-700 text-sm font-medium">
              Password updated.
              {forced && " Taking you to the home page..."}
            </p>
          )}

          <div className="flex gap-2">
            <NeoButton
              type="submit"
              backgroundColor="#fd3777"
              textColor="#ffffff"
              disabled={submitting}
            >
              {submitting ? "Saving..." : "Update password"}
            </NeoButton>
            {!forced && (
              <NeoButton
                type="button"
                onClick={() => navigate(-1)}
                backgroundColor="#ffffff"
                textColor="#000000"
              >
                Cancel
              </NeoButton>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
