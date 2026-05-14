import { API_BASE } from "@/lib/api";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/auth-context";
import NeoButton from "@/components/neo/neo-button";

type Settings = { logout_on_close: boolean };

export default function SessionCard() {
  const auth = useAuth();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<boolean>(false);
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
        setSettings({ logout_on_close: !!data.logout_on_close });
        setDraft(!!data.logout_on_close);
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

  const dirty = settings !== null && draft !== settings.logout_on_close;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/settings/logout-on-close`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({ value: draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Server error: ${res.status}`);
      setSettings({ logout_on_close: !!data.logout_on_close });
      setDraft(!!data.logout_on_close);
      // Also reflect immediately on the local cached user so the current
      // session picks it up without waiting for the next validateToken.
      auth.updateUser({ logoutOnClose: !!data.logout_on_close });
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
        <h3 className="font-black text-lg">Sign out on app close</h3>
        <p className="text-sm text-muted-foreground">
          When on, the desktop app forgets credentials each time it's closed,
          so users (including you) must sign in again on next launch.
          Web sessions are unaffected.
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
          <strong>Enabled.</strong> Forget credentials on app close.
        </span>
      </label>

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
            onClick={() => setDraft(settings.logout_on_close)}
            className="text-xs underline text-muted-foreground"
          >
            Revert
          </button>
        )}
      </div>
    </div>
  );
}
