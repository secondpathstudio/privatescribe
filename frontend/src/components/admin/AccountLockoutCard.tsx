import { API_BASE } from "@/lib/api";
import { useEffect, useState, FormEvent } from "react";
import { useAuth } from "@/context/auth-context";
import NeoButton from "@/components/neo/neo-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Settings = {
    account_lockout_threshold: number;
    account_lockout_threshold_min: number;
    account_lockout_threshold_max: number;
    account_lockout_minutes: number;
    account_lockout_minutes_min: number;
    account_lockout_minutes_max: number;
};

export default function AccountLockoutCard() {
    const auth = useAuth();
    const [settings, setSettings] = useState<Settings | null>(null);
    const [thresholdDraft, setThresholdDraft] = useState<string>("");
    const [minutesDraft, setMinutesDraft] = useState<string>("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [savedAt, setSavedAt] = useState<number | null>(null);

    const fetchSettings = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/admin/settings`, {
                headers: { Authorization: `Bearer ${auth.token}` },
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `Server error: ${res.status}`);
            setSettings(data);
            setThresholdDraft(String(data.account_lockout_threshold));
            setMinutesDraft(String(data.account_lockout_minutes));
            setError(null);
        } catch (e: any) {
            setError(e.message || "Could not load settings");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchSettings();
    }, [auth.token]);

    const dirty =
        settings != null &&
        (thresholdDraft !== String(settings.account_lockout_threshold) ||
            minutesDraft !== String(settings.account_lockout_minutes));

    const threshold = parseInt(thresholdDraft, 10);
    const lockoutDisabled = threshold === 0;

    const handleSave = async (e: FormEvent) => {
        e.preventDefault();
        const minutes = parseInt(minutesDraft, 10);
        if (Number.isNaN(threshold) || Number.isNaN(minutes)) {
            setError("Enter a number for both fields (0 attempts = lockout disabled)");
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const res = await fetch(`${API_BASE}/api/admin/settings/account-lockout`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${auth.token}`,
                },
                body: JSON.stringify({ threshold, minutes }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `Server error: ${res.status}`);
            setSettings((prev) =>
                prev
                    ? {
                          ...prev,
                          account_lockout_threshold: data.account_lockout_threshold,
                          account_lockout_minutes: data.account_lockout_minutes,
                      }
                    : prev,
            );
            setThresholdDraft(String(data.account_lockout_threshold));
            setMinutesDraft(String(data.account_lockout_minutes));
            setSavedAt(Date.now());
        } catch (e: any) {
            setError(e.message || "Failed to save");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Account lockout</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                    After too many failed sign-in attempts in a row, an account is
                    temporarily locked &mdash; even a correct password is refused until
                    the lock lapses. This is a per-account brute-force backstop that
                    survives a backend restart. The counter resets to zero on any
                    successful sign-in. Set the attempt limit to <strong>0</strong> to
                    turn lockout off entirely.
                </p>
                {loading && <p>Loading…</p>}
                {!loading && settings && (
                    <form onSubmit={handleSave} className="space-y-4">
                        <div>
                            <Label htmlFor="lockout-threshold" className="font-black">
                                Failed attempts before lockout
                            </Label>
                            <Input
                                id="lockout-threshold"
                                type="number"
                                min={settings.account_lockout_threshold_min}
                                max={settings.account_lockout_threshold_max}
                                step={1}
                                value={thresholdDraft}
                                onChange={(e) => setThresholdDraft(e.target.value)}
                                className="max-w-xs"
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                                Allowed range: {settings.account_lockout_threshold_min}–
                                {settings.account_lockout_threshold_max}.{" "}
                                <strong>0</strong> disables lockout.
                            </p>
                        </div>

                        <div>
                            <Label htmlFor="lockout-minutes" className="font-black">
                                Lockout duration (minutes)
                            </Label>
                            <Input
                                id="lockout-minutes"
                                type="number"
                                min={settings.account_lockout_minutes_min}
                                max={settings.account_lockout_minutes_max}
                                step={1}
                                value={minutesDraft}
                                onChange={(e) => setMinutesDraft(e.target.value)}
                                className="max-w-xs"
                                disabled={lockoutDisabled}
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                                Allowed range: {settings.account_lockout_minutes_min}–
                                {settings.account_lockout_minutes_max} minutes. The
                                account unlocks itself once this passes; an admin can
                                also unlock it sooner from the Users page.
                            </p>
                        </div>

                        {lockoutDisabled && (
                            <p className="text-sm text-amber-700">
                                Lockout is disabled. Only the per-IP rate limit guards
                                against password guessing.
                            </p>
                        )}
                        {error && <p className="text-red-600 text-sm">{error}</p>}
                        {savedAt && !error && (
                            <p className="text-green-700 text-sm">
                                Saved. Applies to the next sign-in attempt.
                            </p>
                        )}
                        <NeoButton
                            type="submit"
                            backgroundColor="#fd3777"
                            textColor="#ffffff"
                            disabled={saving || !dirty}
                        >
                            {saving ? "Saving…" : "Save settings"}
                        </NeoButton>
                    </form>
                )}
                {!loading && !settings && error && (
                    <p className="text-red-600 text-sm">Error: {error}</p>
                )}
            </CardContent>
        </Card>
    );
}
