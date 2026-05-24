import { useEffect, useState } from "react";
import SectionHeader from "./SectionHeader";
import { API_BASE } from "@/lib/api";
import { useAuth } from "@/context/auth-context";
import { isSuperAdmin } from "@/lib/roles";
import NeoButton from "@/components/neo/neo-button";

/**
 * Server status/admin dashboard (roadmap Phase 9 item 5). Super-admin view of
 * the running server, fed by GET /api/admin/server/status. When the app is the
 * server's control panel (window.electron.server present) it also shows the
 * pairing URL and the stop-server control.
 *
 * Daemon-level service health (Caddy/Ollama up?) is observed launchd-side and
 * is wired in with the live control-panel runtime (device-tested).
 */
type Status = {
  mode: string;
  whisperModel: string;
  whisperLoaded: string | null;
  activeSessions: number;
  users: number;
  organizations: number;
  lastBackupAt: string | null;
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border-2 border-black bg-white p-4">
      <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-2xl font-black mt-1">{value}</div>
    </div>
  );
}

export default function ServerDashboard() {
  const auth = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pairingUrl, setPairingUrl] = useState<string | null>(null);

  const isController = !!window.electron?.server;

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/admin/server/status`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 403 ? "Super-admin access required." : `Status ${r.status}`);
        return r.json();
      })
      .then((d) => { if (!cancelled) setStatus(d); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    if (isController) {
      window.electron!.server!.info().then((i) => { if (!cancelled && i) setPairingUrl(i.pairingUrl); });
    }
    return () => { cancelled = true; };
  }, [auth.token, isController]);

  if (!isSuperAdmin(auth.user?.role)) {
    return (
      <>
        <SectionHeader title="Server" description="Server status and controls." />
        <p className="text-sm text-muted-foreground">
          The server dashboard is available to the super-admin (central IT) account.
        </p>
      </>
    );
  }

  const stopServer = async () => {
    if (!window.electron?.server) return;
    if (!window.confirm("Stop and remove the server background services? Clients will lose access until it's reinstalled.")) return;
    const res = await window.electron.server.uninstall();
    if (!res.ok) setError(res.error || "Failed to stop the server.");
  };

  return (
    <>
      <SectionHeader title="Server" description="Status of the PrivateScribe server this Mac is running." />

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      {status && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
          <Stat label="Mode" value={status.mode} />
          <Stat label="Connected (approx)" value={status.activeSessions} />
          <Stat label="Transcription model" value={status.whisperLoaded || status.whisperModel} />
          <Stat label="Users" value={status.users} />
          <Stat label="Departments" value={status.organizations} />
          <Stat label="Last backup" value={status.lastBackupAt ? new Date(status.lastBackupAt).toLocaleString() : "Never"} />
        </div>
      )}

      {pairingUrl && (
        <div className="border-2 border-black p-4 mb-4">
          <div className="font-black mb-1">Client pairing address</div>
          <div className="font-mono text-sm break-all">{pairingUrl}</div>
          <p className="text-sm text-muted-foreground mt-2">
            Staff connect their PrivateScribe app here. On first connection each
            client confirms this server's security fingerprint.
          </p>
        </div>
      )}

      <div className="border-2 border-black bg-yellow-100 p-4 mb-4 text-sm">
        <div className="font-black">Backups &amp; recovery</div>
        <p className="mt-1">
          {status?.lastBackupAt
            ? `Last backup: ${new Date(status.lastBackupAt).toLocaleString()}.`
            : "No backup has been recorded yet."}{" "}
          Back up the encryption key (.env) separately from the data archive — the
          archive is unrecoverable without it. See the disaster-recovery runbook
          (backend/DISASTER_RECOVERY.md). Restore is an offline command run with
          the server stopped.
        </p>
      </div>

      {isController && (
        <div className="border-2 border-red-600 p-4">
          <div className="font-black text-red-700">Danger zone</div>
          <p className="text-sm text-muted-foreground mt-1 mb-3">
            Stops the background services and removes them. Clients lose access
            until the server is set up again. Your data is left untouched.
          </p>
          <NeoButton label="Stop &amp; remove server" backgroundColor="#dc2626" textColor="#ffffff" onClick={stopServer} />
        </div>
      )}
    </>
  );
}
