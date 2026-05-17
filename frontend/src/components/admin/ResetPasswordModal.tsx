import { API_BASE } from "@/lib/api";
import { FormEvent, useState } from "react";
import { useAuth } from "@/context/auth-context";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import NeoButton from "@/components/neo/neo-button";

const MIN_LEN = 8;

type Props = {
  userId: string;
  userEmail: string;
  onClose: () => void;
  onSuccess?: () => void;
};

export default function ResetPasswordModal({ userId, userEmail, onClose, onSuccess }: Props) {
  const auth = useAuth();
  const [adminPassword, setAdminPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword.length < MIN_LEN) {
      setError(`New password must be at least ${MIN_LEN} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${userId}/reset-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({ adminPassword, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Server error ${res.status}`);
        return;
      }
      setSuccess(true);
      onSuccess?.();
    } catch (e: any) {
      setError(e.message ?? "Network error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md border-[3px] border-black bg-white shadow-[6px_6px_0_0_#000]">
        <div className="border-b-2 border-black bg-[#5d1d91] px-5 py-3">
          <h3 className="font-black uppercase tracking-wide text-white">Reset Password</h3>
        </div>

        <div className="p-5">
          <p className="text-sm mb-1">
            Reset password for <strong>{userEmail}</strong>.
          </p>
          <p className="text-xs text-muted-foreground mb-4">
            The user will be required to change this password on their next login.
          </p>

          {success ? (
            <>
              <div className="border-[2px] border-black bg-green-100 p-3 text-sm">
                Password reset. <strong>{userEmail}</strong> will be prompted to choose a new
                one when they next sign in.
              </div>
              <div className="mt-4 flex justify-end">
                <NeoButton onClick={onClose} backgroundColor="#fd3777" textColor="#ffffff">
                  Done
                </NeoButton>
              </div>
            </>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="reset-admin-password" className="font-black">
                  Your password
                </Label>
                <PasswordInput
                  id="reset-admin-password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  autoComplete="current-password"
                  autoFocus
                  required
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Confirms it's really you doing this.
                </p>
              </div>
              <div>
                <Label htmlFor="reset-new-password" className="font-black">
                  New password for {userEmail}
                </Label>
                <PasswordInput
                  id="reset-new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </div>
              <div>
                <Label htmlFor="reset-confirm-password" className="font-black">
                  Confirm new password
                </Label>
                <PasswordInput
                  id="reset-confirm-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </div>

              {error && <p className="text-red-600 text-sm">{error}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <NeoButton
                  type="button"
                  onClick={onClose}
                  backgroundColor="#ffffff"
                  textColor="#000000"
                  disabled={submitting}
                >
                  Cancel
                </NeoButton>
                <NeoButton
                  type="submit"
                  backgroundColor="#fd3777"
                  textColor="#ffffff"
                  disabled={submitting}
                >
                  {submitting ? "Resetting..." : "Reset password"}
                </NeoButton>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
