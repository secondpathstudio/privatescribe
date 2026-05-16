import { API_BASE } from "@/lib/api";
import { FormEvent, useState } from "react";
import { useAuth } from "@/context/auth-context";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import NeoButton from "@/components/neo/neo-button";

type Props = {
  userId: string;
  userEmail: string;
  action: "deactivate" | "activate";
  onClose: () => void;
  onSuccess?: () => void;
};

export default function DeactivateUserModal({
  userId,
  userEmail,
  action,
  onClose,
  onSuccess,
}: Props) {
  const auth = useAuth();
  const [adminPassword, setAdminPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const deactivating = action === "deactivate";
  const title = deactivating ? "Deactivate user" : "Reactivate user";

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${userId}/${action}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({ adminPassword }),
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
          <h3 className="font-black uppercase tracking-wide text-white">{title}</h3>
        </div>

        <div className="p-5">
          <p className="text-sm mb-1">
            {deactivating ? "Deactivate" : "Reactivate"} <strong>{userEmail}</strong>.
          </p>
          <p className="text-xs text-muted-foreground mb-4">
            {deactivating
              ? "Ends all of their active sessions immediately and blocks sign-in. Their notes, templates, and participants are kept. Reversible."
              : "Restores sign-in access for this account."}
          </p>

          {success ? (
            <>
              <div className="border-[2px] border-black bg-green-100 p-3 text-sm">
                {userEmail} {deactivating ? "deactivated" : "reactivated"}.
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
                <Label htmlFor="deactivate-admin-password" className="font-black">
                  Your password
                </Label>
                <Input
                  id="deactivate-admin-password"
                  type="password"
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
                  disabled={submitting || !adminPassword}
                >
                  {submitting ? "Working..." : title}
                </NeoButton>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
