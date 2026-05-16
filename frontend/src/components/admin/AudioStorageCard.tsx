import { API_BASE } from "@/lib/api";
import { useEffect, useState, FormEvent } from "react";
import { useAuth } from "@/context/auth-context";
import NeoButton from "@/components/neo/neo-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Settings = {
    audio_storage_enabled: boolean;
    audio_retention_days: number;
    audio_retention_days_min: number;
    audio_retention_days_max: number;
};

export default function AudioStorageCard() {
    const auth = useAuth();
    const [settings, setSettings] = useState<Settings | null>(null);
    const [storageDraft, setStorageDraft] = useState<boolean>(true);
    const [daysDraft, setDaysDraft] = useState<string>("");
    // True while the "what about existing audio?" prompt is showing — set when
    // the admin tries to save with storage flipped from on to off.
    const [confirmDisable, setConfirmDisable] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [savedMsg, setSavedMsg] = useState<string | null>(null);

    const fetchSettings = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/admin/settings`, {
                headers: { Authorization: `Bearer ${auth.token}` },
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `Server error: ${res.status}`);
            setSettings(data);
            setStorageDraft(Boolean(data.audio_storage_enabled));
            setDaysDraft(String(data.audio_retention_days));
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
        (storageDraft !== settings.audio_storage_enabled ||
            daysDraft !== String(settings.audio_retention_days));

    const doSave = async (purgeExisting: boolean) => {
        const days = parseInt(daysDraft, 10);
        if (Number.isNaN(days)) {
            setError("Enter a retention period in days (0 = keep indefinitely)");
            return;
        }
        setSaving(true);
        setError(null);
        setConfirmDisable(false);
        try {
            const res = await fetch(`${API_BASE}/api/admin/settings/audio-storage`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${auth.token}`,
                },
                body: JSON.stringify({
                    storageEnabled: storageDraft,
                    retentionDays: days,
                    purgeExisting,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `Server error: ${res.status}`);
            setSettings((prev) =>
                prev
                    ? {
                          ...prev,
                          audio_storage_enabled: data.audio_storage_enabled,
                          audio_retention_days: data.audio_retention_days,
                      }
                    : prev,
            );
            setStorageDraft(Boolean(data.audio_storage_enabled));
            setDaysDraft(String(data.audio_retention_days));
            const purged = data.audio_purged_count;
            setSavedMsg(
                typeof purged === "number"
                    ? `Saved. Deleted ${purged} stored audio file(s).`
                    : "Saved. Applies to the next transcription.",
            );
        } catch (e: any) {
            setError(e.message || "Failed to save");
        } finally {
            setSaving(false);
        }
    };

    const handleSave = (e: FormEvent) => {
        e.preventDefault();
        setSavedMsg(null);
        // Turning storage off: ask what to do with audio already on disk
        // before committing anything.
        if (settings?.audio_storage_enabled && !storageDraft) {
            setConfirmDisable(true);
            return;
        }
        doSave(false);
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Audio storage</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                    Every recording sent for transcription can be encrypted and kept on disk
                    so the saved note has a playable recording. Turn storage off to make
                    transcription text-only &mdash; the recording is discarded once the
                    transcript is produced. When storage is on, the retention period sets how
                    long each recording is kept before the scheduled{" "}
                    <code>flask purge-audio</code> job deletes it.
                </p>
                {loading && <p>Loading…</p>}
                {!loading && settings && (
                    <form onSubmit={handleSave} className="space-y-4">
                        <div>
                            <label className="flex items-start gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="mt-1 h-4 w-4 border-2 border-black accent-[#fd3777]"
                                    checked={storageDraft}
                                    onChange={(e) => {
                                        setStorageDraft(e.target.checked);
                                        setConfirmDisable(false);
                                    }}
                                />
                                <span className="text-sm">
                                    <span className="font-black">Save audio recordings.</span>{" "}
                                    When enabled, each upload is encrypted and stored. When
                                    disabled, transcription still works but the recording is
                                    not kept.
                                </span>
                            </label>
                        </div>

                        <div>
                            <Label htmlFor="audio-retention-days" className="font-black">
                                Retention period (days)
                            </Label>
                            <Input
                                id="audio-retention-days"
                                type="number"
                                min={settings.audio_retention_days_min}
                                max={settings.audio_retention_days_max}
                                step={1}
                                value={daysDraft}
                                onChange={(e) => setDaysDraft(e.target.value)}
                                disabled={!storageDraft}
                                className="max-w-xs"
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                                Counted from when each recording was uploaded. Allowed range:{" "}
                                {settings.audio_retention_days_min}–
                                {settings.audio_retention_days_max} days. <strong>0</strong>{" "}
                                keeps audio indefinitely. Current value:{" "}
                                <strong>{settings.audio_retention_days} day(s)</strong>.
                            </p>
                        </div>

                        {error && <p className="text-red-600 text-sm">{error}</p>}
                        {savedMsg && !error && (
                            <p className="text-green-700 text-sm">{savedMsg}</p>
                        )}

                        {confirmDisable ? (
                            <div className="border-2 border-black bg-yellow-50 p-3 space-y-3">
                                <p className="text-sm">
                                    <span className="font-black">
                                        Turning off audio storage.
                                    </span>{" "}
                                    New recordings won't be saved. What should happen to audio
                                    already stored on disk?
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    <NeoButton
                                        type="button"
                                        backgroundColor="#ffffff"
                                        textColor="#000000"
                                        disabled={saving}
                                        onClick={() => doSave(false)}
                                    >
                                        {saving ? "Saving…" : "Keep existing audio"}
                                    </NeoButton>
                                    <NeoButton
                                        type="button"
                                        backgroundColor="#fd3777"
                                        textColor="#ffffff"
                                        disabled={saving}
                                        onClick={() => doSave(true)}
                                    >
                                        {saving ? "Saving…" : "Delete all stored audio"}
                                    </NeoButton>
                                    <NeoButton
                                        type="button"
                                        backgroundColor="#ffffff"
                                        textColor="#000000"
                                        disabled={saving}
                                        onClick={() => setConfirmDisable(false)}
                                    >
                                        Cancel
                                    </NeoButton>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Deleting stored audio is permanent and cannot be undone.
                                    Notes keep their transcript text either way.
                                </p>
                            </div>
                        ) : (
                            <NeoButton
                                type="submit"
                                backgroundColor="#fd3777"
                                textColor="#ffffff"
                                disabled={saving || !dirty}
                            >
                                {saving ? "Saving…" : "Save settings"}
                            </NeoButton>
                        )}
                    </form>
                )}
                {!loading && !settings && error && (
                    <p className="text-red-600 text-sm">Error: {error}</p>
                )}
            </CardContent>
        </Card>
    );
}
