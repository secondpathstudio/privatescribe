import { useNavigate } from "react-router";
import { useAuth } from "@/context/auth-context";

/**
 * Persistent warning shown to admins who haven't yet backed up the SQLCipher
 * key. Non-dismissible by design — the only way to clear it is to actually
 * view + acknowledge the key in /admin/encryption, which requires password
 * re-authentication. We never expose the key itself here; this is just the
 * obligation reminder.
 */
export default function PendingBackupKeyBanner() {
  const auth = useAuth();
  const navigate = useNavigate();

  if (auth.user?.role !== "admin" || !auth.user.pendingBackupKeyAcknowledgment) {
    return null;
  }

  return (
    <div
      role="alert"
      className="bg-yellow-200 border-b-4 border-black px-4 py-3 flex items-center justify-between gap-4"
    >
      <p className="text-sm text-black font-medium">
        <span className="font-black uppercase mr-2">⚠ Action required:</span>
        The encryption key has not been backed up. Without it, your data cannot be recovered if anything happens to{" "}
        <code className="font-mono">backend/.env</code>.
      </p>
      <button
        onClick={() => navigate("/admin/encryption")}
        className="text-sm font-bold underline text-black whitespace-nowrap"
      >
        View encryption key →
      </button>
    </div>
  );
}
