import { API_BASE } from "@/lib/api";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/auth-context";
import { isAdmin } from "@/lib/roles";

interface ExportEntry {
  adminEmail: string;
  isSelf: boolean;
  exportedAt: string;
  ip: string | null;
}

export default function KeyExportBanner() {
  const auth = useAuth();
  const [exports, setExports] = useState<ExportEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!isAdmin(auth.user?.role) || !auth.token) {
      setExports([]);
      setLoaded(false);
      return;
    }
    let cancelled = false;
    fetch(`${API_BASE}/api/admin/key-exports/unseen`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    })
      .then((r) => (r.ok ? r.json() : { exports: [] }))
      .then((data) => {
        if (!cancelled) {
          setExports(data.exports ?? []);
          setLoaded(true);
        }
      })
      .catch(() => { /* swallow — not worth nagging the user over a transient fetch */ });
    return () => { cancelled = true; };
  }, [auth.token, auth.user?.role]);

  const dismiss = async () => {
    try {
      await fetch(`${API_BASE}/api/admin/key-exports/dismiss`, {
        method: "POST",
        headers: { Authorization: `Bearer ${auth.token}` },
      });
    } finally {
      setExports([]);
    }
  };

  if (!loaded || exports.length === 0) return null;

  const latest = exports[0];
  const when = new Date(latest.exportedAt).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  const headline = latest.isSelf
    ? `You exported the encryption key on ${when}.`
    : `Encryption key was exported by ${latest.adminEmail} on ${when}.`;
  const extra =
    exports.length > 1
      ? ` (+${exports.length - 1} earlier export${exports.length > 2 ? "s" : ""})`
      : "";

  return (
    <div
      role="alert"
      className="bg-yellow-200 border-b-4 border-black px-4 py-3 flex items-center justify-between gap-4"
    >
      <p className="text-sm text-black font-medium">
        {headline}
        {extra}
      </p>
      <button
        onClick={dismiss}
        className="text-sm font-bold underline text-black whitespace-nowrap"
      >
        Dismiss
      </button>
    </div>
  );
}
