import { API_BASE } from "@/lib/api";
import { flagOllamaDown } from "@/lib/ollama";
import { useEffect, useState, FormEvent, useRef } from "react";
import { useAuth } from "@/context/auth-context";
import NeoButton from "@/components/neo/neo-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type InstalledModel = {
    name: string;
    parameter_size?: string | null;
    /** Footprint on disk in bytes, from `ollama list`. */
    size?: number | null;
    /** Currently held in Ollama's memory, from `ollama ps`. */
    loaded?: boolean;
};

type ProgressEvent = {
    status?: string;
    digest?: string;
    total?: number;
    completed?: number;
    error?: string;
    done?: boolean;
};

export default function ModelsCard() {
    const auth = useAuth();
    const [models, setModels] = useState<InstalledModel[] | null>(null);
    const [defaultModel, setDefaultModel] = useState<string | null>(null);
    const [listError, setListError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    // Name of the model an action (set-active) is in flight for, so its row's
    // controls disable without freezing the whole list.
    const [busyModel, setBusyModel] = useState<string | null>(null);
    const [pullName, setPullName] = useState("");
    const [pulling, setPulling] = useState(false);
    const [progress, setProgress] = useState<ProgressEvent | null>(null);
    const [pullError, setPullError] = useState<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    const fetchModels = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/ollama/models`, {
                headers: { Authorization: `Bearer ${auth.token}` },
            });
            const data = await res.json();
            if (!res.ok) {
                if (res.status === 503) flagOllamaDown();
                setListError(data.error || `Server error: ${res.status}`);
                setModels([]);
                return;
            }
            setModels(data.models || []);
            setDefaultModel(data.default || null);
            setListError(null);
        } catch (e: any) {
            setListError(e.message || "Could not reach the server");
            setModels([]);
        }
    };

    // Ollama treats `name` and `name:latest` as the same model; the list API
    // returns the tagged form but the stored default may be untagged.
    const sameModel = (a?: string | null, b?: string | null) => {
        const tag = (n?: string | null) => (!n || n.includes(":") ? n : `${n}:latest`);
        return tag(a) === tag(b);
    };

    const handleSetActive = async (name: string) => {
        setBusyModel(name);
        setActionError(null);
        try {
            const res = await fetch(`${API_BASE}/api/admin/settings/llm-model`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${auth.token}`,
                },
                body: JSON.stringify({ value: name }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                if (res.status === 503) flagOllamaDown();
                throw new Error(data.error || `Server error: ${res.status}`);
            }
            await fetchModels();
        } catch (e: any) {
            setActionError(e.message || "Could not set the active model");
        } finally {
            setBusyModel(null);
        }
    };

    useEffect(() => {
        fetchModels();
        return () => abortRef.current?.abort();
    }, [auth.token]);

    const handlePull = async (e: FormEvent) => {
        e.preventDefault();
        const name = pullName.trim();
        if (!name) return;

        setPulling(true);
        setProgress({ status: "starting" });
        setPullError(null);

        const controller = new AbortController();
        abortRef.current = controller;

        try {
            const res = await fetch(`${API_BASE}/api/ollama/pull`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${auth.token}`,
                },
                body: JSON.stringify({ model: name }),
                signal: controller.signal,
            });

            if (!res.ok || !res.body) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || `Server error: ${res.status}`);
            }

            // Stream NDJSON: one JSON object per line. The last line carries
            // {done: true} (with `error` set on failure, `status: "success"` on
            // success). Anything before that is a progress update.
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

            if (finalEvent?.error) {
                setPullError(finalEvent.error);
            } else {
                setPullName("");
                await fetchModels();
            }
        } catch (e: any) {
            if (e.name !== "AbortError") {
                setPullError(e.message || "Pull failed");
            }
        } finally {
            setPulling(false);
            abortRef.current = null;
        }
    };

    const percent =
        progress?.total && progress?.completed
            ? Math.min(100, Math.round((progress.completed / progress.total) * 100))
            : null;

    const formatBytes = (n?: number) => {
        if (!n) return "";
        const units = ["B", "KB", "MB", "GB"];
        let v = n;
        let i = 0;
        while (v >= 1024 && i < units.length - 1) {
            v /= 1024;
            i++;
        }
        return `${v.toFixed(1)} ${units[i]}`;
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Ollama Models</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div>
                    <p className="text-sm text-muted-foreground mb-2">
                        Models installed in the local Ollama server. Templates can only use models
                        listed here. The <strong>active</strong> model formats every template that
                        doesn't pin its own. Pulling requires internet access.
                    </p>
                    {listError && <p className="text-red-600 text-sm">{listError}</p>}
                    {actionError && <p className="text-red-600 text-sm">{actionError}</p>}
                    {models === null && <p className="text-sm">Loading...</p>}
                    {models !== null && models.length === 0 && !listError && (
                        <p className="text-sm text-muted-foreground">No models installed yet.</p>
                    )}
                    {models !== null && models.length > 0 && (
                        <ul className="border-2 border-black divide-y-2 divide-black">
                            {models.map((m) => {
                                const isActive = sameModel(m.name, defaultModel);
                                return (
                                    <li
                                        key={m.name}
                                        className="flex flex-wrap justify-between items-center gap-2 px-3 py-2 text-sm"
                                    >
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className="font-mono truncate">{m.name}</span>
                                            {isActive && (
                                                <span className="text-[10px] font-black uppercase tracking-wider border-2 border-black bg-[#fd3777] text-white px-1.5 py-0.5">
                                                    Active
                                                </span>
                                            )}
                                            {m.loaded && (
                                                <span className="text-[10px] font-black uppercase tracking-wider border-2 border-black bg-[#a3e636] px-1.5 py-0.5">
                                                    In memory
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                                                {m.parameter_size}
                                                {m.parameter_size && m.size ? " · " : ""}
                                                {m.size ? formatBytes(m.size) : ""}
                                            </span>
                                            {!isActive && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleSetActive(m.name)}
                                                    disabled={busyModel !== null}
                                                    className="text-xs font-bold uppercase tracking-wider border-2 border-black bg-white px-2 py-1 shadow-[2px_2px_0px_0px_#000000] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:bg-gray-200 disabled:text-gray-500 disabled:shadow-none"
                                                >
                                                    {busyModel === m.name ? "Setting..." : "Set active"}
                                                </button>
                                            )}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>

                <hr className="border-t-2 border-black" />

                <form onSubmit={handlePull} className="space-y-3">
                    <div>
                        <Label htmlFor="pull-model" className="font-black">Pull a model</Label>
                        <p className="text-xs text-muted-foreground mb-1">
                            Tag from the Ollama library (e.g. <code>llama3.2</code>, <code>mistral:7b</code>,{" "}
                            <code>qwen2.5:14b</code>). The download is multi-GB and may take a while.
                        </p>
                        <Input
                            id="pull-model"
                            value={pullName}
                            onChange={(e) => setPullName(e.target.value)}
                            placeholder="model[:tag]"
                            disabled={pulling}
                        />
                    </div>
                    {pullError && <p className="text-red-600 text-sm">{pullError}</p>}
                    {pulling && progress && (
                        <div className="text-sm space-y-1 border-2 border-black p-2 bg-yellow-50">
                            <div>
                                <strong>{progress.status || "working..."}</strong>
                                {progress.digest && (
                                    <span className="ml-2 text-xs font-mono text-muted-foreground">
                                        {progress.digest.slice(0, 12)}
                                    </span>
                                )}
                            </div>
                            {percent !== null && (
                                <>
                                    <div className="h-2 border-2 border-black overflow-hidden">
                                        <div
                                            className="h-full bg-[#fd3777]"
                                            style={{ width: `${percent}%` }}
                                        />
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                        {formatBytes(progress.completed)} / {formatBytes(progress.total)} ({percent}%)
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                    <div className="flex gap-2">
                        <NeoButton
                            type="submit"
                            backgroundColor="#fd3777"
                            textColor="#ffffff"
                            disabled={pulling || !pullName.trim()}
                        >
                            {pulling ? "Pulling..." : "Pull"}
                        </NeoButton>
                        {pulling && (
                            <NeoButton
                                type="button"
                                onClick={() => abortRef.current?.abort()}
                                backgroundColor="#ffffff"
                                textColor="#000000"
                            >
                                Cancel
                            </NeoButton>
                        )}
                    </div>
                </form>
            </CardContent>
        </Card>
    );
}
