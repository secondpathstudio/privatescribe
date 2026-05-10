import { useEffect, useState, FormEvent } from "react";
import { useAuth } from "@/context/auth-context";
import UsersTable from "@/components/users-table";
import AddUserForm from "@/components/admin/AddUserForm";
import BackupKeyModal from "@/components/admin/BackupKeyModal";
import ModelsCard from "@/components/admin/ModelsCard";
import UploadLimitCard from "@/components/admin/UploadLimitCard";
import NeoButton from "@/components/neo/neo-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Admin() {
  const auth = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
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

  const handleRotateKey = async (e: FormEvent) => {
    e.preventDefault();
    setRotating(true);
    setRotateError(null);
    try {
      const res = await fetch("http://127.0.0.1:5000/api/admin/rotate-backup-key", {
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
    } catch (e: any) {
      setRotateError(e.message ?? "Failed to rotate key");
    } finally {
      setRotating(false);
    }
  };

  const handleExportKey = async (e: FormEvent) => {
    e.preventDefault();
    setExporting(true);
    setExportError(null);
    try {
      const res = await fetch("http://127.0.0.1:5000/api/admin/backup-key", {
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

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const response = await fetch('http://127.0.0.1:5000/api/getAllUsers', {
          headers: {
            'Authorization': `Bearer ${auth.token}`,
          },
        });
        if (!response.ok) throw new Error(`Server error: ${response.status}`);
        setUsers(await response.json());
      } catch (e: any) {
        setError(e.message ?? 'Failed to load users');
      } finally {
        setLoading(false);
      }
    };
    fetchUsers();
  }, [auth.token]);

  return (
    <div className="max-w-screen-lg mx-auto px-4 py-10 space-y-6">
      <h1 className="text-4xl font-black">Admin</h1>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Users</CardTitle>
            {!showAddForm && (
              <NeoButton
                onClick={() => setShowAddForm(true)}
                backgroundColor="#fd3777"
                textColor="#ffffff"
              >
                Add User
              </NeoButton>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {showAddForm && (
            <AddUserForm
              onSuccess={(newUser) => {
                setUsers((prev) => [...prev, newUser]);
                setShowAddForm(false);
              }}
              onCancel={() => setShowAddForm(false)}
            />
          )}
          {loading && <p>Loading users...</p>}
          {error && <p className="text-red-600">Error: {error}</p>}
          {!loading && !error && <UsersTable users={users} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Templates</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Coming soon: review and manage all templates across users.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Encryption</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Re-export the SQLCipher key that protects your database. You'll need to confirm your password.
            Save it somewhere durable — losing both this key and <code>backend/.env</code> means the database is unrecoverable.
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
                <Label htmlFor="export-password" className="font-black">Confirm password</Label>
                <Input
                  id="export-password"
                  type="password"
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
                  onClick={() => { setShowKeyForm(false); setKeyFormPassword(""); setExportError(null); }}
                  backgroundColor="#ffffff"
                  textColor="#000000"
                >
                  Cancel
                </NeoButton>
              </div>
            </form>
          )}

          <hr className="border-t-2 border-black my-4" />

          <p className="text-sm text-muted-foreground">
            Rotate the SQLCipher key. The database is re-encrypted in place with a fresh key —
            no data is lost, but <strong>any existing backup of the database file becomes unopenable</strong>,
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
                <Label htmlFor="rotate-password" className="font-black">Confirm password to rotate</Label>
                <Input
                  id="rotate-password"
                  type="password"
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
                  onClick={() => { setShowRotateForm(false); setRotatePassword(""); setRotateError(null); }}
                  backgroundColor="#ffffff"
                  textColor="#000000"
                >
                  Cancel
                </NeoButton>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <ModelsCard />

      <UploadLimitCard />

      <Card>
        <CardHeader>
          <CardTitle>System</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Coming soon: storage usage, audit log.</p>
        </CardContent>
      </Card>

      {exportedKey && (
        <BackupKeyModal
          backupKey={exportedKey}
          onAcknowledge={async () => {}}
          blocking={false}
          onClose={() => setExportedKey(null)}
        />
      )}

      {rotatedKey && (
        <BackupKeyModal
          backupKey={rotatedKey}
          onAcknowledge={async () => {}}
          blocking={false}
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
    </div>
  );
}
