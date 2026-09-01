import { API_BASE } from "@/lib/api";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/auth-context";
import NeoButton from "@/components/neo/neo-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Capabilities = {
    word_confidence: boolean;
    segment_timestamps: boolean;
    prompt_biasing: boolean;
    live_ticks: boolean;
};

type Catalog = {
    engines: { name: string; capabilities: Capabilities }[];
    active: string;
    medasr: {
        installed: boolean;
        licenseAccepted: boolean;
        acceptance: { acceptedByEmail?: string; acceptedAt?: string } | null;
        termsUrl: string;
        approxSizeMb: number;
    };
};

type ProgressEvent = {
    status?: string;
    completed?: number;
    total?: number;
    message?: string;
    done?: boolean;
};

const ENGINE_LABELS: Record<string, { title: string; blurb: string }> = {
    whisper: {
        title: "Whisper (general purpose)",
        blurb: "Transcribes any speech and supports every feature: confidence highlighting, speaker identification, custom vocabulary biasing.",
    },
    medasr: {
        title: "MedASR (medical dictation)",
        blurb: "Google's open medical dictation model. Markedly better clinical vocabulary and normalization (\"forty milligrams\" → \"40 mg\"), and it inserts dictation section headers like [ASSESSMENT] and [PLAN].",
    },
};

// What each capability flag means to an end user, shown when an engine lacks it.
const CAPABILITY_LABELS: Record<keyof Capabilities, string> = {
    word_confidence: "Confidence highlighting when reviewing transcripts",
    segment_timestamps: "Speaker identification (diarization) labels",
    prompt_biasing: "Custom vocabulary biasing during transcription",
    live_ticks: "Live transcription preview while recording",
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

export default function SttEngineCard() {
    const auth = useAuth();
    const [catalog, setCatalog] = useState<Catalog | null>(null);
    const [listError, setListError] = useState<string | null>(null);
    const [selected, setSelected] = useState<string>("");
    const [termsRead, setTermsRead] = useState(false);
    const [busy, setBusy] = useState(false);
    const [installing, setInstalling] = useState(false);
    const [progress, setProgress] = useState<ProgressEvent | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [doneMessage, setDoneMessage] = useState<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    const authHeaders = { Authorization: `Bearer ${auth.token}` };

    const fetchCatalog = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/admin/settings/stt/engines`, {
                headers: authHeaders,
            });
            const data = await res.json();
            if (!res.ok) {
                setListError(data.error || `Server error: ${res.status}`);
                return;
            }
            setCatalog(data);
            setListError(null);
            setSelected((prev) => prev || data.active);
        } catch (e: unknown) {
            setListError(e instanceof Error ? e.message : "Could not reach the server");
        }
    };

    useEffect(() => {
        fetchCatalog();
        return () => abortRef.current?.abort();
    }, [auth.token]);

    const acceptLicense = async () => {
        setBusy(true);
        setActionError(null);
        try {
            const res = await fetch(`${API_BASE}/api/admin/settings/stt/medasr/accept-license`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeaders },
                body: JSON.stringify({ accepted: true }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `Server error: ${res.status}`);
            await fetchCatalog();
        } catch (e: unknown) {
            setActionError(e instanceof Error ? e.message : "Could not record acceptance");
        } finally {
            setBusy(false);
        }
    };

    const installMedasr = async () => {
        if (!catalog) return;
        if (
            !window.confirm(
                `Download the MedASR model?\n\nThis downloads roughly ${catalog.medasr.approxSizeMb} MB — ` +
                `you must be online. Once it finishes the app runs fully offline again.`,
            )
        )
            return;

        setInstalling(true);
        setProgress({ status: "starting" });
        setActionError(null);
        setDoneMessage(null);

        const controller = new AbortController();
        abortRef.current = controller;

        try {
            const res = await fetch(`${API_BASE}/api/admin/settings/stt/medasr/install`, {
                method: "POST",
                headers: authHeaders,
                signal: controller.signal,
            });
            if (!res.ok || !res.body) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || `Server error: ${res.status}`);
            }

            // NDJSON stream: one JSON object per line. Terminal line carries
            // done:true — status "installed" on success, "error" on failure.
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

            if (finalEvent?.status === "installed") {
                setDoneMessage(
                    "MedASR is downloaded. Activate it below to start using it for transcription.",
                );
                await fetchCatalog();
            } else {
                setActionError(finalEvent?.message || "Install ended unexpectedly.");
            }
        } catch (e: unknown) {
            if (e instanceof Error && e.name === "AbortError") {
                setActionError("Install cancelled. Nothing was changed.");
            } else {
                setActionError(e instanceof Error ? e.message : "Install failed");
            }
        } finally {
            setInstalling(false);
            abortRef.current = null;
        }
    };

    const activate = async (engine: string) => {
        setBusy(true);
        setActionError(null);
        setDoneMessage(null);
        try {
            const res = await fetch(`${API_BASE}/api/admin/settings/stt/engine`, {
                method: "PUT",
                headers: { "Content-Type": "application/json", ...authHeaders },
                body: JSON.stringify({ engine }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `Server error: ${res.status}`);
            setDoneMessage(
                engine === "medasr"
                    ? "MedASR is now the active engine — it applies from the next recording on."
                    : "Whisper is now the active engine — it applies from the next recording on.",
            );
            await fetchCatalog();
        } catch (e: unknown) {
            setActionError(e instanceof Error ? e.message : "Could not switch the engine");
        } finally {
            setBusy(false);
        }
    };

    const percent =
        progress?.total && progress?.completed
            ? Math.min(100, Math.round((progress.completed / progress.total) * 100))
            : null;

    const selectedEngine = catalog?.engines.find((e) => e.name === selected);
    const missing = selectedEngine
        ? (Object.keys(CAPABILITY_LABELS) as (keyof Capabilities)[]).filter(
              (k) => !selectedEngine.capabilities[k],
          )
        : [];

    // The medasr option-C ladder: read+accept terms → download → activate.
    const medasrNeedsLicense = selected === "medasr" && !catalog?.medasr.licenseAccepted;
    const medasrNeedsInstall =
        selected === "medasr" && !!catalog?.medasr.licenseAccepted && !catalog?.medasr.installed;
    const medasrReady =
        selected === "medasr" && !!catalog?.medasr.licenseAccepted && !!catalog?.medasr.installed;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Speech-to-text engine</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                    The engine that turns recorded audio into text for everyone in this
                    organization. Whisper is the general-purpose default; MedASR is a
                    specialist for single-speaker medical dictation.
                </p>

                {listError && <p className="text-red-600 text-sm">{listError}</p>}
                {catalog === null && !listError && <p className="text-sm">Loading...</p>}

                {catalog && (
                    <>
                        <div className="space-y-2">
                            {catalog.engines.map((engine) => {
                                const label = ENGINE_LABELS[engine.name] ?? {
                                    title: engine.name,
                                    blurb: "",
                                };
                                const isActive = catalog.active === engine.name;
                                return (
                                    <label
                                        key={engine.name}
                                        className={`flex items-start gap-3 border-2 border-black p-3 cursor-pointer ${
                                            selected === engine.name ? "bg-yellow-50" : "bg-white"
                                        }`}
                                    >
                                        <input
                                            type="radio"
                                            name="stt-engine"
                                            className="mt-1"
                                            checked={selected === engine.name}
                                            onChange={() => setSelected(engine.name)}
                                            disabled={installing || busy}
                                        />
                                        <span className="text-sm">
                                            <strong>{label.title}</strong>
                                            {isActive && (
                                                <span className="ml-2 text-xs border-2 border-black bg-green-50 px-1 font-black">
                                                    ACTIVE
                                                </span>
                                            )}
                                            <br />
                                            <span className="text-muted-foreground">{label.blurb}</span>
                                        </span>
                                    </label>
                                );
                            })}
                        </div>

                        {missing.length > 0 && (
                            <div className="text-sm border-2 border-black bg-amber-50 p-2">
                                <strong>Not available with this engine:</strong>
                                <ul className="list-disc ml-5 mt-1">
                                    {missing.map((k) => (
                                        <li key={k}>{CAPABILITY_LABELS[k]}</li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {medasrNeedsLicense && (
                            <div className="text-sm border-2 border-black p-3 space-y-2">
                                <p>
                                    MedASR is provided by Google under the{" "}
                                    <a
                                        href={catalog.medasr.termsUrl}
                                        target="_blank"
                                        rel="noreferrer noopener"
                                        className="underline font-black"
                                    >
                                        Health AI Developer Foundations terms
                                    </a>
                                    . An administrator must read and accept them once before the
                                    model can be downloaded.
                                </p>
                                <label className="flex items-start gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        className="mt-1"
                                        checked={termsRead}
                                        onChange={(e) => setTermsRead(e.target.checked)}
                                        disabled={busy}
                                    />
                                    <span>
                                        I have read the Health AI Developer Foundations terms,
                                        including the prohibited use policy, and accept them on
                                        behalf of this organization.
                                    </span>
                                </label>
                                <NeoButton
                                    type="button"
                                    onClick={acceptLicense}
                                    disabled={!termsRead || busy}
                                    backgroundColor="#fd3777"
                                    textColor="#ffffff"
                                >
                                    {busy ? "Recording…" : "Accept terms"}
                                </NeoButton>
                            </div>
                        )}

                        {medasrNeedsInstall && (
                            <div className="text-sm border-2 border-black p-3 space-y-2">
                                <p className="text-xs text-muted-foreground">
                                    Terms accepted
                                    {catalog.medasr.acceptance?.acceptedByEmail &&
                                        ` by ${catalog.medasr.acceptance.acceptedByEmail}`}
                                    {catalog.medasr.acceptance?.acceptedAt &&
                                        ` on ${new Date(catalog.medasr.acceptance.acceptedAt).toLocaleDateString()}`}
                                    .
                                </p>
                                <NeoButton
                                    type="button"
                                    onClick={installMedasr}
                                    disabled={installing}
                                    backgroundColor="#fd3777"
                                    textColor="#ffffff"
                                >
                                    {installing
                                        ? "Downloading…"
                                        : `Download MedASR (~${catalog.medasr.approxSizeMb} MB)`}
                                </NeoButton>
                            </div>
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

                        {actionError && <p className="text-red-600 text-sm">{actionError}</p>}
                        {doneMessage && (
                            <p className="text-sm border-2 border-black bg-green-50 p-2">{doneMessage}</p>
                        )}

                        {(selected === "whisper" || medasrReady) && selected !== catalog.active && (
                            <div>
                                <NeoButton
                                    type="button"
                                    onClick={() => activate(selected)}
                                    disabled={busy || installing}
                                    backgroundColor="#fd3777"
                                    textColor="#ffffff"
                                >
                                    {busy ? "Switching…" : `Activate ${ENGINE_LABELS[selected]?.title ?? selected}`}
                                </NeoButton>
                            </div>
                        )}
                    </>
                )}
            </CardContent>
        </Card>
    );
}
