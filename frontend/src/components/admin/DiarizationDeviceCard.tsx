import { API_BASE } from "@/lib/api";
import { useEffect, useState, FormEvent } from "react";
import { useAuth } from "@/context/auth-context";
import NeoButton from "@/components/neo/neo-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type DeviceOption = "auto" | "mps" | "cuda" | "cpu";

type Settings = {
    diarization_device: DeviceOption;
    diarization_device_effective: string | null;
    diarization_devices_available: string[];
    diarization_device_options: DeviceOption[];
};

// Human-readable labels for each device. Kept here rather than on the backend
// so the UI can phrase things in product terms ("Apple Silicon GPU") without
// the backend caring about presentation.
const DEVICE_LABELS: Record<string, string> = {
    auto: "Auto (detect best available)",
    mps: "Apple Silicon GPU (MPS)",
    cuda: "NVIDIA GPU (CUDA)",
    cpu: "CPU",
};

export default function DiarizationDeviceCard() {
    const auth = useAuth();
    const [settings, setSettings] = useState<Settings | null>(null);
    const [draft, setDraft] = useState<DeviceOption>("auto");
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
            setDraft(data.diarization_device);
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
        setSaving(true);
        setError(null);
        try {
            const res = await fetch(`${API_BASE}/api/admin/settings/diarization-device`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${auth.token}`,
                },
                body: JSON.stringify({ value: draft }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `Server error: ${res.status}`);
            setSettings((prev) => prev ? {
                ...prev,
                diarization_device: data.diarization_device,
                diarization_device_effective: data.diarization_device_effective,
            } : prev);
            setSavedAt(Date.now());
        } catch (e: any) {
            setError(e.message || "Failed to save");
        } finally {
            setSaving(false);
        }
    };

    // Available device options = "auto" + whatever torch reports usable. We
    // show concrete devices unavailable on this host as disabled rather than
    // hiding them entirely, so admins can see what's not present.
    const renderOption = (opt: DeviceOption) => {
        const isAvailable = opt === "auto" || (settings?.diarization_devices_available ?? []).includes(opt);
        const label = DEVICE_LABELS[opt] ?? opt;
        return (
            <SelectItem key={opt} value={opt} disabled={!isAvailable}>
                {label}{!isAvailable && " — not available on this host"}
            </SelectItem>
        );
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Speaker identification (diarization)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                    Which device pyannote runs on. GPU (MPS / CUDA) is typically 3–5× faster than
                    CPU for speaker identification. <strong>Auto</strong> picks the fastest
                    device available at startup. Changes apply immediately — the loaded pipeline
                    is moved to the new device without a restart.
                </p>
                {loading && <p>Loading...</p>}
                {!loading && settings && (
                    <form onSubmit={handleSave} className="space-y-3">
                        <div>
                            <Label htmlFor="diarization-device" className="font-black">Device</Label>
                            <Select value={draft} onValueChange={(v) => setDraft(v as DeviceOption)}>
                                <SelectTrigger id="diarization-device" className="max-w-xs bg-white">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-white">
                                    {settings.diarization_device_options.map(renderOption)}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground mt-1">
                                Configured: <strong>{DEVICE_LABELS[settings.diarization_device] ?? settings.diarization_device}</strong>
                                {". "}
                                Currently running on:{" "}
                                <strong>
                                    {settings.diarization_device_effective
                                        ? (DEVICE_LABELS[settings.diarization_device_effective] ?? settings.diarization_device_effective)
                                        : "not yet loaded (will load on first transcription)"}
                                </strong>
                                {"."}
                            </p>
                        </div>
                        {error && <p className="text-red-600 text-sm">{error}</p>}
                        {savedAt && !error && (
                            <p className="text-green-700 text-sm">Saved. Applies to the next transcription.</p>
                        )}
                        <NeoButton
                            type="submit"
                            backgroundColor="#fd3777"
                            textColor="#ffffff"
                            disabled={saving || draft === settings.diarization_device}
                        >
                            {saving ? "Saving..." : "Save device"}
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
