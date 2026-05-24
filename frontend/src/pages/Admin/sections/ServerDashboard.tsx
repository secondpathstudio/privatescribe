import { useEffect, useState } from "react";
import QRCode from "react-qr-code";
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
  lanIp: string | null;
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
    return () => { cancelled = true; };
  }, [auth.token]);

  const isController = !!window.electron?.server;

  // The scannable pairing URL: the server's LAN IP (from the backend, since the
  // admin usually views this via localhost) + the port the dashboard was served
  // on (Caddy's LAN port). Null until we know the LAN IP.
  const pairingUrl = status?.lanIp
    ? `${window.location.protocol}//${status.lanIp}${window.location.port ? `:${window.location.port}` : ""}`
    : null;

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

  const restartServer = async () => {
    if (!window.electron?.server) return;
    const res = await window.electron.server.restart();
    if (!res.ok) setError(res.error || "Failed to restart the server.");
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
          <div className="font-black mb-1">Pair a device</div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="bg-white border-2 border-black p-2 shrink-0">
              <QRCode value={pairingUrl} size={148} />
            </div>
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">
                Scan this with a device on the same network to open the
                PrivateScribe login page, or enter the address manually:
              </p>
              <div className="font-mono text-sm break-all mt-2">{pairingUrl}</div>
              <p className="text-xs text-muted-foreground mt-2">
                It's a self-signed certificate on your private network, so the
                device shows a one-time security warning to accept on first connect.
              </p>
            </div>
          </div>
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
            Restart the services (e.g. to apply an update), or stop and remove
            them entirely. Clients lose access while the server is stopped. Your
            data is left untouched.
          </p>
          <div className="flex flex-wrap gap-2">
            <NeoButton label="Restart services" backgroundColor="#000000" textColor="#ffffff" onClick={restartServer} />
            <NeoButton label="Stop &amp; remove server" backgroundColor="#dc2626" textColor="#ffffff" onClick={stopServer} />
          </div>
        </div>
      )}
    </>
  );
}
