import { API_BASE } from "@/lib/api";
import { useEffect, useState, FormEvent } from "react";
import { useAuth } from "@/context/auth-context";
import NeoButton from "@/components/neo/neo-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Watermark = {
    seq: number;
    entry_hash: string | null;
    archived_at: string;
    total_archived: number;
    last_archive_file: string;
};

type Settings = {
    audit_retention_days: number;
    audit_retention_days_min: number;
    audit_retention_days_max: number;
    audit_auto_purge: boolean;
    audit_archive_watermark: Watermark | null;
};

const formatDate = (value: string | null | undefined) => {
    if (!value) return "—";
    const d = new Date(value);
    return isNaN(d.getTime())
        ? value
        : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

export default function AuditRetentionCard() {
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
            setDaysDraft(String(data.audit_retention_days));
            setAutoPurgeDraft(Boolean(data.audit_auto_purge));
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
        (daysDraft !== String(settings.audit_retention_days) ||
            autoPurgeDraft !== settings.audit_auto_purge);

    const handleSave = async (e: FormEvent) => {
        e.preventDefault();
        const days = parseInt(daysDraft, 10);
        if (Number.isNaN(days)) {
            setError("Enter a number of days (0 = keep the trail forever)");
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const res = await fetch(`${API_BASE}/api/admin/settings/audit-retention`, {
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
                          audit_retention_days: data.audit_retention_days,
                          audit_auto_purge: data.audit_auto_purge,
                      }
                    : prev,
            );
            setDaysDraft(String(data.audit_retention_days));
            setAutoPurgeDraft(Boolean(data.audit_auto_purge));
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
                <CardTitle>Audit log retention</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                    Audit entries are append-only and tamper-evident, so they are never
                    silently dropped. This is how many days an entry is kept before the
                    scheduled job (<code>flask purge-audit-log</code>) <strong>archives it
                    to a JSON file</strong> on disk and then removes it from the table &mdash;
                    the archive file is the permanent record. Set it to match your required
                    record-retention period; HIPAA expects at least 6 years.{" "}
                    <strong>0</strong> disables purging entirely: the full trail is kept in
                    the database forever.
                </p>
                {loading && <p>Loading…</p>}
                {!loading && settings && (
                    <form onSubmit={handleSave} className="space-y-4">
                        <div>
                            <Label htmlFor="audit-retention-days" className="font-black">
                                Retention period (days)
                            </Label>
                            <Input
                                id="audit-retention-days"
                                type="number"
                                min={settings.audit_retention_days_min}
                                max={settings.audit_retention_days_max}
                                step={1}
                                value={daysDraft}
                                onChange={(e) => setDaysDraft(e.target.value)}
                                className="max-w-xs"
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                                Allowed range: {settings.audit_retention_days_min}–
                                {settings.audit_retention_days_max} days. Current value:{" "}
                                <strong>{settings.audit_retention_days} day(s)</strong>{" "}
                                (~{Math.round((settings.audit_retention_days / 365) * 10) / 10}{" "}
                                years).
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
                                    <span className="font-black">Auto-purge old entries.</span>{" "}
                                    When enabled, the scheduled job archives-and-deletes
                                    entries once they pass the retention period. When disabled,
                                    nothing is purged unless the job is run with{" "}
                                    <code>--force</code>.
                                </span>
                            </label>
                        </div>

                        {settings.audit_archive_watermark && (
                            <p className="text-xs text-muted-foreground border-l-2 border-black/20 pl-2">
                                Archived so far:{" "}
                                <strong>
                                    {settings.audit_archive_watermark.total_archived}
                                </strong>{" "}
                                entry(ies). Most recent archive file:{" "}
                                <code>
                                    {settings.audit_archive_watermark.last_archive_file}
                                </code>{" "}
                                ({formatDate(settings.audit_archive_watermark.archived_at)}).
                            </p>
                        )}

                        {error && <p className="text-red-600 text-sm">{error}</p>}
                        {savedAt && !error && (
                            <p className="text-green-700 text-sm">
                                Saved. The next scheduled purge reads the new policy.
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
