import { API_BASE } from "@/lib/api";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/auth-context";
import NeoButton from "@/components/neo/neo-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Catalog = {
    available: string[];
    installed: string[];
    active: string;
    loaded: string | null;
    approxSizeMb: Record<string, number>;
};

type ProgressEvent = {
    status?: string;
    model?: string;
    completed?: number;
    total?: number;
    totalBytes?: number;
    message?: string;
    done?: boolean;
};

const formatBytes = (n?: number) => {
    if (!n) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let v = n;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i++;
    }
    return `${v.toFixed(1)} ${units[i]}`;
};

export default function WhisperModelCard() {
    const auth = useAuth();
    const [catalog, setCatalog] = useState<Catalog | null>(null);
    const [listError, setListError] = useState<string | null>(null);
    const [selected, setSelected] = useState<string>("");
    const [installing, setInstalling] = useState(false);
    const [progress, setProgress] = useState<ProgressEvent | null>(null);
    const [installError, setInstallError] = useState<string | null>(null);
    const [doneMessage, setDoneMessage] = useState<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    const fetchCatalog = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/admin/settings/whisper/models`, {
                headers: { Authorization: `Bearer ${auth.token}` },
            });
            const data = await res.json();
            if (!res.ok) {
                setListError(data.error || `Server error: ${res.status}`);
                return;
            }
            setCatalog(data);
            setListError(null);
            // Default the dropdown to whatever is currently active.
            setSelected((prev) => prev || data.active);
        } catch (e: unknown) {
            setListError(e instanceof Error ? e.message : "Could not reach the server");
        }
    };

    useEffect(() => {
        fetchCatalog();
        return () => abortRef.current?.abort();
    }, [auth.token]);

    const handleInstall = async () => {
        if (!catalog || !selected) return;

        const alreadyInstalled = catalog.installed.includes(selected);
        const approx = catalog.approxSizeMb[selected];
        const confirmMsg = alreadyInstalled
            ? `Activate the "${selected}" model? It's already downloaded, so this just switches transcription to use it.`
            : `Download and activate the "${selected}" model?\n\n` +
              `This downloads roughly ${approx} MB from Hugging Face — you must be online. ` +
              `Once it finishes you can go back offline.`;
        if (!window.confirm(confirmMsg)) return;

        setInstalling(true);
        setProgress({ status: "starting" });
        setInstallError(null);
        setDoneMessage(null);

        const controller = new AbortController();
        abortRef.current = controller;

        try {
            const res = await fetch(`${API_BASE}/api/admin/settings/whisper/install`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${auth.token}`,
                },
                body: JSON.stringify({ model: selected }),
                signal: controller.signal,
            });

            if (!res.ok || !res.body) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || `Server error: ${res.status}`);
            }

            // NDJSON stream: one JSON object per line. Terminal line carries
            // done:true — status "activated" on success, "error" on failure.
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let finalEvent: ProgressEvent | null = null;

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";
                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const evt: ProgressEvent = JSON.parse(line);
                        setProgress(evt);
                        if (evt.done) finalEvent = evt;
                    } catch {
                        // ignore malformed line
                    }
                }
            }

            if (finalEvent?.status === "error") {
                setInstallError(finalEvent.message || "Install failed.");
            } else if (finalEvent?.status === "activated") {
                setDoneMessage(
                    `"${finalEvent.model}" is downloaded and now active. Transcription ` +
                    `will use it from the next recording on — safe to go offline.`,
                );
                await fetchCatalog();
            } else {
                setInstallError("Install ended unexpectedly.");
            }
        } catch (e: unknown) {
            if (e instanceof Error && e.name === "AbortError") {
                setInstallError("Install cancelled. The previous model is still active.");
            } else {
                setInstallError(e instanceof Error ? e.message : "Install failed");
            }
        } finally {
            setInstalling(false);
            abortRef.current = null;
        }
    };

    const percent =
        progress?.total && progress?.completed
            ? Math.min(100, Math.round((progress.completed / progress.total) * 100))
            : null;

    const selectedInstalled = catalog?.installed.includes(selected) ?? false;
    const selectedIsActive = catalog?.active === selected;
    // Nothing to do when the chosen model is both installed and already active.
    const actionDisabled = installing || !catalog || (selectedInstalled && selectedIsActive);

    return (
        <Card>
            <CardHeader>
                <CardTitle>Whisper transcription model</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                    The speech-to-text model used for all transcription. Larger models are more
                    accurate but slower and use more memory. Switching downloads the model first,
                    so do it while online — afterwards the app runs fully offline.
                </p>

                {listError && <p className="text-red-600 text-sm">{listError}</p>}
                {catalog === null && !listError && <p className="text-sm">Loading...</p>}

                {catalog && (
                    <>
                        <div className="space-y-2">
                            <label className="font-black text-sm">Model size</label>
                            <Select value={selected} onValueChange={setSelected} disabled={installing}>
                                <SelectTrigger className="bg-white">
                                    <SelectValue placeholder="Select a model" />
                                </SelectTrigger>
                                <SelectContent className="bg-white">
                                    {catalog.available.map((size) => {
                                        const installed = catalog.installed.includes(size);
                                        const isActive = catalog.active === size;
                                        const mb = catalog.approxSizeMb[size];
                                        return (
                                            <SelectItem key={size} value={size}>
                                                {size}
                                                <span className="text-xs text-muted-foreground ml-2">
                                                    ~{mb} MB
                                                    {isActive ? " · active" : installed ? " · downloaded" : ""}
                                                </span>
                                            </SelectItem>
                                        );
                                    })}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                Active model: <strong>{catalog.active}</strong>
                                {catalog.loaded && catalog.loaded !== catalog.active && (
                                    <span className="text-amber-600">
                                        {" "}(in memory: {catalog.loaded} — next transcription reloads)
                                    </span>
                                )}
                            </p>
                        </div>

                        {installError && <p className="text-red-600 text-sm">{installError}</p>}
                        {doneMessage && (
                            <p className="text-sm border-2 border-black bg-green-50 p-2">{doneMessage}</p>
                        )}

                        {installing && progress && (
                            <div className="text-sm space-y-1 border-2 border-black p-2 bg-yellow-50">
                                <div>
                                    <strong>
                                        {progress.status === "starting"
                                            ? "Preparing download…"
                                            : progress.status === "downloading"
                                            ? "Downloading…"
                                            : progress.status || "Working…"}
                                    </strong>
                                </div>
                                {percent !== null && (
                                    <>
                                        <div className="h-2 border-2 border-black overflow-hidden">
                                            <div className="h-full bg-[#fd3777]" style={{ width: `${percent}%` }} />
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            {formatBytes(progress.completed)} / {formatBytes(progress.total)} ({percent}%)
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        <div>
                            <NeoButton
                                type="button"
                                onClick={handleInstall}
                                disabled={actionDisabled}
                                backgroundColor="#fd3777"
                                textColor="#ffffff"
                            >
                                {installing
                                    ? "Installing…"
                                    : selectedIsActive
                                    ? "Already active"
                                    : selectedInstalled
                                    ? "Activate"
                                    : "Download & activate"}
                            </NeoButton>
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
}
