import { API_BASE } from "@/lib/api";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/auth-context";
import NeoButton from "@/components/neo/neo-button";

type Policy = "standard" | "strict";

const POLICY_INFO: Record<Policy, { label: string; blurb: string; rules: string[] }> = {
  standard: {
    label: "Standard",
    blurb:
      "Minimal friction — a length floor and nothing else. Fine for a single-user personal install where an awkward password is more nuisance than protection.",
    rules: ["At least 8 characters"],
  },
  strict: {
    label: "Strict",
    blurb:
      "The multi-user / professional posture. Recommended anywhere real patient data lives.",
    rules: [
      "At least 12 characters",
      "At least 3 of: lowercase letters, uppercase letters, digits, symbols",
      "Rejects common and breached passwords",
    ],
  },
};

export default function PasswordPolicyCard() {
  const auth = useAuth();
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [draft, setDraft] = useState<Policy>("standard");
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
        const value: Policy = data.password_policy === "strict" ? "strict" : "standard";
        setPolicy(value);
        setDraft(value);
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

  const dirty = policy !== null && draft !== policy;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/settings/password-policy`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({ value: draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Server error: ${res.status}`);
      const value: Policy = data.password_policy === "strict" ? "strict" : "standard";
      setPolicy(value);
      setDraft(value);
    } catch (e: any) {
      setError(e.message ?? "Could not save");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (policy === null) {
    return <p className="text-red-600 text-sm">{error ?? "Could not load settings"}</p>;
  }

  return (
    <div className="border-2 border-black bg-white p-5 space-y-4">
      <div>
        <h3 className="font-black text-lg">Password policy</h3>
        <p className="text-sm text-muted-foreground">
          Applies to every place a password is set — admin "create user",
          first-run setup, self-service password changes, admin resets, and the
          create-admin CLI. Changing it only affects passwords set from now on;
          existing accounts aren't forced to re-enter a password.
        </p>
      </div>

      <div className="space-y-3">
        {(Object.keys(POLICY_INFO) as Policy[]).map((key) => {
          const info = POLICY_INFO[key];
          return (
            <label
              key={key}
              className={[
                "flex items-start gap-3 cursor-pointer select-none border-2 p-3",
                draft === key ? "border-black bg-gray-50" : "border-gray-200",
              ].join(" ")}
            >
              <input
                type="radio"
                name="password-policy"
                checked={draft === key}
                onChange={() => setDraft(key)}
                className="mt-1 size-4 border-2 border-black accent-[#fd3777]"
              />
              <span className="text-sm">
                <strong>{info.label}.</strong> {info.blurb}
                <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                  {info.rules.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </span>
            </label>
          );
        })}
      </div>

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
            onClick={() => setDraft(policy)}
            className="text-xs underline text-muted-foreground"
          >
            Revert
          </button>
        )}
      </div>
    </div>
  );
}
