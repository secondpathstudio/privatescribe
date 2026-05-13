import { API_BASE } from "@/lib/api";
import { useEffect, useState, FormEvent } from "react";
import { useAuth } from "@/context/auth-context";
import NeoButton from "@/components/neo/neo-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Settings = {
    trash_retention_days: number;
    trash_retention_days_min: number;
    trash_retention_days_max: number;
    trash_auto_purge: boolean;
};

export default function TrashRetentionCard() {
    const auth = useAuth();
    const [settings, setSettings] = useState<Settings | null>(null);
    const [daysDraft, setDaysDraft] = useState<string>("");
    const [autoPurgeDraft, setAutoPurgeDraft] = useState<boolean>(false);
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
            setDaysDraft(String(data.trash_retention_days));
            setAutoPurgeDraft(Boolean(data.trash_auto_purge));
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
        (daysDraft !== String(settings.trash_retention_days) ||
            autoPurgeDraft !== settings.trash_auto_purge);

    const handleSave = async (e: FormEvent) => {
        e.preventDefault();
        const days = parseInt(daysDraft, 10);
        if (Number.isNaN(days)) {
            setError("Enter a number of days (0 = no waiting period)");
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const res = await fetch(`${API_BASE}/api/admin/settings/trash-retention`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${auth.token}`,
                },
                body: JSON.stringify({ retentionDays: days, autoPurge: autoPurgeDraft }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `Server error: ${res.status}`);
            setSettings((prev) =>
                prev
                    ? {
                          ...prev,
                          trash_retention_days: data.trash_retention_days,
                          trash_auto_purge: data.trash_auto_purge,
                      }
                    : prev,
            );
            setDaysDraft(String(data.trash_retention_days));
            setAutoPurgeDraft(Boolean(data.trash_auto_purge));
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
                <CardTitle>Trash retention</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                    When a note or template is deleted it goes to the trash rather than being
                    erased. This is the minimum number of days an item must stay in the trash
                    before anyone can permanently delete it &mdash; set it to match whatever
                    record-retention period your organization is required to keep (e.g. clinical
                    or legal records). <strong>0</strong> means no waiting period: items can be
                    permanently deleted immediately.
                </p>
                {loading && <p>Loading…</p>}
                {!loading && settings && (
                    <form onSubmit={handleSave} className="space-y-4">
                        <div>
                            <Label htmlFor="retention-days" className="font-black">
                                Retention period (days)
                            </Label>
                            <Input
                                id="retention-days"
                                type="number"
                                min={settings.trash_retention_days_min}
                                max={settings.trash_retention_days_max}
                                step={1}
                                value={daysDraft}
                                onChange={(e) => setDaysDraft(e.target.value)}
                                className="max-w-xs"
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                                Allowed range: {settings.trash_retention_days_min}–
                                {settings.trash_retention_days_max} days. Current value:{" "}
                                <strong>{settings.trash_retention_days} day(s)</strong>.
                            </p>
                        </div>

                        <div>
                            <label className="flex items-start gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="mt-1 h-4 w-4 border-2 border-black accent-[#fd3777]"
                                    checked={autoPurgeDraft}
                                    onChange={(e) => setAutoPurgeDraft(e.target.checked)}
                                />
                                <span className="text-sm">
                                    <span className="font-black">Auto-purge old trash.</span>{" "}
                                    When enabled, a scheduled job (<code>flask purge-trash</code>)
                                    permanently deletes items once they pass the retention period.
                                    When disabled, items stay in the trash until someone deletes
                                    them by hand.
                                </span>
                            </label>
                        </div>

                        {error && <p className="text-red-600 text-sm">{error}</p>}
                        {savedAt && !error && (
                            <p className="text-green-700 text-sm">
                                Saved. Applies to the next permanent-delete.
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
