import { API_BASE } from "@/lib/api";
import { FormEvent, useState } from "react";
import { useAuth } from "@/context/auth-context";
import BackupKeyModal from "@/components/admin/BackupKeyModal";
import NeoButton from "@/components/neo/neo-button";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import SectionHeader from "./SectionHeader";

export default function EncryptionSection() {
  const auth = useAuth();
  const [showKeyForm, setShowKeyForm] = useState(false);
  const [keyFormPassword, setKeyFormPassword] = useState("");
  const [exportedKey, setExportedKey] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [showRotateForm, setShowRotateForm] = useState(false);
  const [rotatePassword, setRotatePassword] = useState("");
  const [rotateError, setRotateError] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [rotatedKey, setRotatedKey] = useState<string | null>(null);

  const handleExportKey = async (e: FormEvent) => {
    e.preventDefault();
    setExporting(true);
    setExportError(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/backup-key`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({ password: keyFormPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Server error: ${res.status}`);
      setExportedKey(data.backup_key);
      setKeyFormPassword("");
      setShowKeyForm(false);
    } catch (e: any) {
      setExportError(e.message ?? "Failed to fetch key");
    } finally {
      setExporting(false);
    }
  };

  const handleRotateKey = async (e: FormEvent) => {
    e.preventDefault();
    setRotating(true);
    setRotateError(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/rotate-backup-key`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({ password: rotatePassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Server error: ${res.status}`);
      setRotatedKey(data.backup_key);
      setRotatePassword("");
      setShowRotateForm(false);
      // Server resets the acknowledgment flag as part of rotation
      // (admin_keys.py reset_backup_key_acknowledgement) so the new key needs
      // a fresh ack. Reflect that locally so the modal we're about to show
      // renders in blocking mode and the banner reappears if the admin
      // dismisses without acknowledging.
      auth.updateUser({ pendingBackupKeyAcknowledgment: true });
    } catch (e: any) {
      setRotateError(e.message ?? "Failed to rotate key");
    } finally {
      setRotating(false);
    }
  };

  const acknowledgeBackupKey = async (onDone: () => void) => {
    try {
      await fetch(`${API_BASE}/api/acknowledge-backup-key`, {
        method: "POST",
        headers: { Authorization: `Bearer ${auth.token}` },
      });
    } finally {
      // Clear locally even on fetch failure — server flag is source of truth
      // and validateToken will resync on next page nav if the request didn't
      // land. Don't trap the user behind a blocking modal.
      auth.updateUser({ pendingBackupKeyAcknowledgment: false });
      onDone();
    }
  };

  return (
    <>
      <SectionHeader
        title="Encryption"
        description="Manage the SQLCipher key that protects your database at rest."
      />

      <div className="border-2 border-black bg-white p-5 space-y-3">
        <h3 className="font-black text-lg">Backup key</h3>
        <p className="text-sm text-muted-foreground">
          Re-export the SQLCipher key. You'll need to confirm your password. Save it somewhere
          durable — losing both this key and <code>backend/.env</code> means the database is unrecoverable.
        </p>
        {!showKeyForm ? (
          <NeoButton
            onClick={() => setShowKeyForm(true)}
            backgroundColor="#fd3777"
            textColor="#ffffff"
          >
            Show backup key
          </NeoButton>
        ) : (
          <form onSubmit={handleExportKey} className="space-y-3">
            <div>
              <Label htmlFor="export-password" className="font-black">
                Confirm password
              </Label>
              <PasswordInput
                id="export-password"
                value={keyFormPassword}
                onChange={(e) => setKeyFormPassword(e.target.value)}
                autoFocus
              />
            </div>
            {exportError && <p className="text-red-600 text-sm">{exportError}</p>}
            <div className="flex gap-2">
              <NeoButton type="submit" backgroundColor="#fd3777" textColor="#ffffff" disabled={exporting}>
                {exporting ? "Verifying..." : "Reveal"}
              </NeoButton>
              <NeoButton
                type="button"
                onClick={() => {
                  setShowKeyForm(false);
                  setKeyFormPassword("");
                  setExportError(null);
                }}
                backgroundColor="#ffffff"
                textColor="#000000"
              >
                Cancel
              </NeoButton>
            </div>
          </form>
        )}
      </div>

      <div className="border-2 border-black bg-white p-5 space-y-3 mt-6">
        <h3 className="font-black text-lg">Rotate key</h3>
        <p className="text-sm text-muted-foreground">
          Rotate the SQLCipher key. The database is re-encrypted in place with a fresh key — no
          data is lost, but <strong>any existing backup of the database file becomes unopenable</strong>,
          and the previous key is permanently invalidated. Save the new key shown after rotation.
        </p>
        {!showRotateForm ? (
          <NeoButton
            onClick={() => setShowRotateForm(true)}
            backgroundColor="#ffffff"
            textColor="#000000"
          >
            Rotate encryption key
          </NeoButton>
        ) : (
          <form onSubmit={handleRotateKey} className="space-y-3">
            <div>
              <Label htmlFor="rotate-password" className="font-black">
                Confirm password to rotate
              </Label>
              <PasswordInput
                id="rotate-password"
                value={rotatePassword}
                onChange={(e) => setRotatePassword(e.target.value)}
                autoFocus
              />
            </div>
            {rotateError && <p className="text-red-600 text-sm">{rotateError}</p>}
            <div className="flex gap-2">
              <NeoButton type="submit" backgroundColor="#fd3777" textColor="#ffffff" disabled={rotating}>
                {rotating ? "Rotating..." : "Rotate now"}
              </NeoButton>
              <NeoButton
                type="button"
                onClick={() => {
                  setShowRotateForm(false);
                  setRotatePassword("");
                  setRotateError(null);
                }}
                backgroundColor="#ffffff"
                textColor="#000000"
              >
                Cancel
              </NeoButton>
            </div>
          </form>
        )}
      </div>

      {exportedKey && (
        <BackupKeyModal
          backupKey={exportedKey}
          onAcknowledge={() => acknowledgeBackupKey(() => setExportedKey(null))}
          blocking={!!auth.user?.pendingBackupKeyAcknowledgment}
          onClose={() => setExportedKey(null)}
        />
      )}

      {rotatedKey && (
        <BackupKeyModal
          backupKey={rotatedKey}
          onAcknowledge={() => acknowledgeBackupKey(() => setRotatedKey(null))}
          blocking={!!auth.user?.pendingBackupKeyAcknowledgment}
          onClose={() => setRotatedKey(null)}
          title="New encryption key"
          description={
            <>
              <p className="mb-2">
                The database has been re-encrypted with this new key. The previous key is now
                invalid and any backup of the database file taken before this rotation can no
                longer be opened.
              </p>
              <p>
                Save this key somewhere durable <strong>now</strong>. Other admins will be
                prompted to save it on their next login.
              </p>
            </>
          }
        />
      )}
    </>
  );
}
