import { useEffect, useState, FormEvent } from "react";
import { useAuth } from "@/context/auth-context";
import NeoButton from "@/components/neo/neo-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Settings = {
    upload_limit_mb: number;
    upload_limit_mb_min: number;
    upload_limit_mb_max: number;
};

export default function UploadLimitCard() {
    const auth = useAuth();
    const [settings, setSettings] = useState<Settings | null>(null);
    const [draft, setDraft] = useState<string>("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [savedAt, setSavedAt] = useState<number | null>(null);

    const fetchSettings = async () => {
        try {
            const res = await fetch("http://127.0.0.1:5000/api/admin/settings", {
                headers: { Authorization: `Bearer ${auth.token}` },
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `Server error: ${res.status}`);
            setSettings(data);
            setDraft(String(data.upload_limit_mb));
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

    const handleSave = async (e: FormEvent) => {
        e.preventDefault();
        const value = parseInt(draft, 10);
        if (Number.isNaN(value)) {
            setError("Enter a number of megabytes");
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const res = await fetch("http://127.0.0.1:5000/api/admin/settings/upload-limit-mb", {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${auth.token}`,
                },
                body: JSON.stringify({ value }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `Server error: ${res.status}`);
            setSettings((prev) => prev ? { ...prev, upload_limit_mb: data.upload_limit_mb } : prev);
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
                <CardTitle>Upload limit</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                    Maximum size for audio uploads on the New Note page. Larger limits let users
                    transcribe longer recordings but consume more memory and disk while processing.
                    Set this based on the host machine's specs.
                </p>
                {loading && <p>Loading...</p>}
                {!loading && settings && (
                    <form onSubmit={handleSave} className="space-y-3">
                        <div>
                            <Label htmlFor="upload-limit" className="font-black">Limit (MB)</Label>
                            <Input
                                id="upload-limit"
                                type="number"
                                min={settings.upload_limit_mb_min}
                                max={settings.upload_limit_mb_max}
                                step={1}
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                className="max-w-xs"
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                                Allowed range: {settings.upload_limit_mb_min}–{settings.upload_limit_mb_max} MB.
                                Current value: <strong>{settings.upload_limit_mb} MB</strong>.
                            </p>
                        </div>
                        {error && <p className="text-red-600 text-sm">{error}</p>}
                        {savedAt && !error && (
                            <p className="text-green-700 text-sm">Saved. Applies to the next upload.</p>
                        )}
                        <NeoButton
                            type="submit"
                            backgroundColor="#fd3777"
                            textColor="#ffffff"
                            disabled={saving || draft === String(settings.upload_limit_mb)}
                        >
                            {saving ? "Saving..." : "Save limit"}
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
