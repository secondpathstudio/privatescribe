import { API_BASE } from "@/lib/api";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/auth-context";
import NeoButton from "@/components/neo/neo-button";

type Settings = { exports_enabled: boolean };

export default function ExportsEnabledCard() {
  const auth = useAuth();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<boolean>(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/admin/settings`, {
          headers: { Authorization: `Bearer ${auth.token}` },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Server error: ${res.status}`);
        if (cancelled) return;
        setSettings({ exports_enabled: !!data.exports_enabled });
        setDraft(!!data.exports_enabled);
        setError(null);
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? "Could not load settings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.token]);

  const dirty = settings !== null && draft !== settings.exports_enabled;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/settings/exports-enabled`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({ value: draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Server error: ${res.status}`);
      setSettings({ exports_enabled: !!data.exports_enabled });
      setDraft(!!data.exports_enabled);
      // Reflect the new value on the locally cached user so SingleNote
      // re-renders without waiting for a re-login.
      auth.updateUser({ exportsEnabled: !!data.exports_enabled });
    } catch (e: any) {
      setError(e.message ?? "Could not save");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (!settings) {
    return <p className="text-red-600 text-sm">{error ?? "Could not load settings"}</p>;
  }

  return (
    <div className="border-2 border-black bg-white p-5 space-y-4">
      <div>
        <h3 className="font-black text-lg">Allow document exports</h3>
        <p className="text-sm text-muted-foreground">
          Users can download any of their own notes as a PDF or DOCX file from
          the note's page. Turning this off hides the download buttons across
          the app and makes the export endpoints return an error, even if a
          user calls them directly.
        </p>
      </div>
      <label className="flex items-start gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={draft}
          onChange={(e) => setDraft(e.target.checked)}
          className="mt-1 size-4 border-2 border-black accent-[#fd3777]"
        />
        <span className="text-sm">
          <strong>Enabled.</strong> Users may download notes as PDF / DOCX.
        </span>
      </label>

      {!draft && settings.exports_enabled && (
        <div className="border-[2px] border-black bg-[#ffff00] p-3 text-xs">
          Turning this off takes effect immediately for everyone — open download
          buttons disappear, and any in-progress export request will fail.
        </div>
      )}

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="flex items-center gap-3">
        <NeoButton
          onClick={handleSave}
          backgroundColor="#fd3777"
          textColor="#ffffff"
          disabled={!dirty || saving}
        >
          {saving ? "Saving..." : "Save"}
        </NeoButton>
        {dirty && !saving && (
          <button
            type="button"
            onClick={() => setDraft(settings.exports_enabled)}
            className="text-xs underline text-muted-foreground"
          >
            Revert
          </button>
        )}
      </div>
    </div>
  );
}
