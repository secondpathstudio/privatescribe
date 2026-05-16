import { API_BASE } from "@/lib/api";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/auth-context";
import NeoButton from "@/components/neo/neo-button";

type Settings = {
  logout_on_close: boolean;
  session_idle_timeout_minutes: number;
};

export default function SessionCard() {
  const auth = useAuth();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [logoutDraft, setLogoutDraft] = useState<boolean>(false);
  const [idleDraft, setIdleDraft] = useState<string>("30");
  const [idleBounds, setIdleBounds] = useState<{ min: number; max: number }>({ min: 0, max: 1440 });
  const [loading, setLoading] = useState(true);
  const [savingLogout, setSavingLogout] = useState(false);
  const [savingIdle, setSavingIdle] = useState(false);
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
        const idle = Number(data.session_idle_timeout_minutes ?? 30);
        setSettings({
          logout_on_close: !!data.logout_on_close,
          session_idle_timeout_minutes: idle,
        });
        setLogoutDraft(!!data.logout_on_close);
        setIdleDraft(String(idle));
        setIdleBounds({
          min: Number(data.session_idle_timeout_minutes_min ?? 0),
          max: Number(data.session_idle_timeout_minutes_max ?? 1440),
        });
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

  const logoutDirty = settings !== null && logoutDraft !== settings.logout_on_close;
  const idleParsed = Number(idleDraft);
  const idleValid =
    idleDraft.trim() !== "" &&
    Number.isInteger(idleParsed) &&
    idleParsed >= idleBounds.min &&
    idleParsed <= idleBounds.max;
  const idleDirty =
    settings !== null && idleValid && idleParsed !== settings.session_idle_timeout_minutes;

  const saveLogout = async () => {
    setSavingLogout(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/settings/logout-on-close`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` },
        body: JSON.stringify({ value: logoutDraft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Server error: ${res.status}`);
      setSettings((s) => (s ? { ...s, logout_on_close: !!data.logout_on_close } : s));
      setLogoutDraft(!!data.logout_on_close);
      auth.updateUser({ logoutOnClose: !!data.logout_on_close });
    } catch (e: any) {
      setError(e.message ?? "Could not save");
    } finally {
      setSavingLogout(false);
    }
  };

  const saveIdle = async () => {
    setSavingIdle(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/settings/session-idle-timeout`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` },
        body: JSON.stringify({ value: idleParsed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Server error: ${res.status}`);
      const saved = Number(data.session_idle_timeout_minutes);
      setSettings((s) => (s ? { ...s, session_idle_timeout_minutes: saved } : s));
      setIdleDraft(String(saved));
      // Reflect on the cached user so this session's idle timer picks up the
      // new duration without waiting for the next validateToken.
      auth.updateUser({ idleTimeoutMinutes: saved });
    } catch (e: any) {
      setError(e.message ?? "Could not save");
    } finally {
      setSavingIdle(false);
    }
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (!settings) {
    return <p className="text-red-600 text-sm">{error ?? "Could not load settings"}</p>;
  }

  return (
    <div className="space-y-6">
      {/* Idle sign-out */}
      <div className="border-2 border-black bg-white p-5 space-y-4">
        <div>
          <h3 className="font-black text-lg">Idle sign-out</h3>
          <p className="text-sm text-muted-foreground">
            Automatically sign a user out after a stretch of inactivity. Applies
            to every account, on web and desktop. Set to <strong>0</strong> to
            disable the idle timeout.
          </p>
        </div>
        <label className="flex flex-col gap-1 max-w-xs">
          <span className="text-sm font-black">Timeout (minutes)</span>
          <input
            type="number"
            min={idleBounds.min}
            max={idleBounds.max}
            value={idleDraft}
            onChange={(e) => setIdleDraft(e.target.value)}
            className="border-2 border-black px-3 py-2 text-sm"
          />
          <span className="text-xs text-muted-foreground">
            {idleBounds.min}–{idleBounds.max} minutes. 0 disables it.
          </span>
        </label>
        {!idleValid && (
          <p className="text-red-600 text-sm">
            Enter a whole number between {idleBounds.min} and {idleBounds.max}.
          </p>
        )}
        <div className="flex items-center gap-3">
          <NeoButton
            onClick={saveIdle}
            backgroundColor="#fd3777"
            textColor="#ffffff"
            disabled={!idleDirty || savingIdle}
          >
            {savingIdle ? "Saving..." : "Save"}
          </NeoButton>
          {idleDirty && !savingIdle && (
            <button
              type="button"
              onClick={() => setIdleDraft(String(settings.session_idle_timeout_minutes))}
              className="text-xs underline text-muted-foreground"
            >
              Revert
            </button>
          )}
        </div>
      </div>

      {/* Sign out on app close */}
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
            checked={logoutDraft}
            onChange={(e) => setLogoutDraft(e.target.checked)}
            className="mt-1 size-4 border-2 border-black accent-[#fd3777]"
          />
          <span className="text-sm">
            <strong>Enabled.</strong> Forget credentials on app close.
          </span>
        </label>
        <div className="flex items-center gap-3">
          <NeoButton
            onClick={saveLogout}
            backgroundColor="#fd3777"
            textColor="#ffffff"
            disabled={!logoutDirty || savingLogout}
          >
            {savingLogout ? "Saving..." : "Save"}
          </NeoButton>
          {logoutDirty && !savingLogout && (
            <button
              type="button"
              onClick={() => setLogoutDraft(settings.logout_on_close)}
              className="text-xs underline text-muted-foreground"
            >
              Revert
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}
    </div>
  );
}
