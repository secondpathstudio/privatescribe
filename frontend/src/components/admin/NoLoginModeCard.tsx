import { API_BASE } from "@/lib/api";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/auth-context";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import NeoButton from "@/components/neo/neo-button";

type Settings = {
  no_login_mode: boolean;
  deployment_mode: string;
};

export default function NoLoginModeCard() {
  const auth = useAuth();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState(false);
  const [password, setPassword] = useState("");
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
        setSettings({
          no_login_mode: !!data.no_login_mode,
          deployment_mode: data.deployment_mode || "standalone",
        });
        setDraft(!!data.no_login_mode);
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

  const dirty = settings !== null && draft !== settings.no_login_mode;
  const isServer = settings?.deployment_mode === "server";

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/settings/no-login-mode`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({ value: draft, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Server error: ${res.status}`);
      setSettings((prev) =>
        prev ? { ...prev, no_login_mode: !!data.no_login_mode } : prev,
      );
      setDraft(!!data.no_login_mode);
      setPassword("");
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
        <h3 className="font-black text-lg">Skip the login screen</h3>
        <p className="text-sm text-muted-foreground">
          When on, this device signs in automatically as you — no password each
          time you open the app — so you can record a quick note right away.
          Admin settings (including this one) still require your password.
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
          <strong>Enabled.</strong> Auto-sign-in without a password.
        </span>
      </label>

      {isServer && draft && (
        <div className="border-[2px] border-black bg-red-200 p-3 text-xs space-y-1">
          <p className="font-black">⚠ This is a networked server install.</p>
          <p>
            No-login mode here means <strong>anyone who can reach this server on
            the network</strong> gets into the notes with no password at all.
            This is intended for a single personal device, not a shared server.
          </p>
        </div>
      )}

      {!isServer && draft && !settings.no_login_mode && (
        <div className="border-[2px] border-black bg-[#ffff00] p-3 text-xs">
          Anyone with access to this device will be able to open the app and read
          or create notes without signing in. Use this only on a device you
          physically control.
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor="no-login-password" className="font-black text-xs">
          CONFIRM YOUR PASSWORD TO SAVE
        </Label>
        <PasswordInput
          id="no-login-password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="flex items-center gap-3">
        <NeoButton
          onClick={handleSave}
          backgroundColor="#fd3777"
          textColor="#ffffff"
          disabled={!dirty || !password || saving}
        >
          {saving ? "Saving..." : "Save"}
        </NeoButton>
        {dirty && !saving && (
          <button
            type="button"
            onClick={() => {
              setDraft(settings.no_login_mode);
              setPassword("");
            }}
            className="text-xs underline text-muted-foreground"
          >
            Revert
          </button>
        )}
      </div>
    </div>
  );
}
