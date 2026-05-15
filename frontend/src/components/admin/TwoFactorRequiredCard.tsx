import { API_BASE } from "@/lib/api";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/auth-context";
import NeoButton from "@/components/neo/neo-button";

type Settings = { two_factor_required: boolean };

export default function TwoFactorRequiredCard() {
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
        setSettings({ two_factor_required: !!data.two_factor_required });
        setDraft(!!data.two_factor_required);
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

  const dirty = settings !== null && draft !== settings.two_factor_required;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/settings/two-factor-required`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({ value: draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Server error: ${res.status}`);
      setSettings({ two_factor_required: !!data.two_factor_required });
      setDraft(!!data.two_factor_required);
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
        <h3 className="font-black text-lg">Require two-factor authentication</h3>
        <p className="text-sm text-muted-foreground">
          Two-factor is always available to users from their Account page. This
          toggle controls whether it's mandatory — when on, anyone who hasn't
          enrolled gets walked through setup at their next sign-in, and enrolled
          users can't turn it off. When off, users can still opt in voluntarily
          and their existing enrollment keeps working.
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
          <strong>Required.</strong> Force every user through TOTP at sign-in.
        </span>
      </label>

      {draft && !settings.two_factor_required && (
        <div className="border-[2px] border-black bg-[#ffff00] p-3 text-xs">
          Heads up — turning this on will force every signed-in user (including you)
          to enroll on their next login. Make sure you have an authenticator app
          ready (Google Authenticator, Authy, 1Password, etc.).
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
            onClick={() => setDraft(settings.two_factor_required)}
            className="text-xs underline text-muted-foreground"
          >
            Revert
          </button>
        )}
      </div>
    </div>
  );
}
