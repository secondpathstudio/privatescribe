import { API_BASE } from "@/lib/api";
import { flagOllamaDown } from "@/lib/ollama";
import { toast } from "sonner";
import React, { FormEvent, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { format } from 'date-fns'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { CalendarIcon } from 'lucide-react'
import ConfidenceText, { type WordInfo, countLowConfidence } from '@/components/transcription/ConfidenceText'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import AudioCapture, { type CaptureOptions } from '@/components/recording/audio-capture'
import MarkdownEditor from '@/components/md-editor'
import { BoldItalicUnderlineToggles, headingsPlugin, listsPlugin, ListsToggle, MDXEditorMethods, quotePlugin, toolbarPlugin, UndoRedo } from '@mdxeditor/editor'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '../../../context/auth-context'
import { useNavigate } from 'react-router'
import NeoButton from '@/components/neo/neo-button'
import ParticipantSelector, { Participant, NewParticipant } from '@/components/participant-selector'

type Props = {
    templates: any[],
    savedParticipants?: Participant[]
}

const NewNoteForm = ({templates, savedParticipants}: Props) => {
    const auth = useAuth();
    const mdxEditorRef = React.useRef<MDXEditorMethods>(null)
    // Lets the user bail out of a hung LLM formatting call (slow hardware /
    // big transcript) instead of staring at "Formatting note..." forever.
    // Set while the formatting stage is in flight, cleared in getMarkdown's
    // finally. Aborting falls back to the raw transcript, same as a 503.
    const formattingAbortRef = React.useRef<AbortController | null>(null)
    // Single pipeline state: null = idle, otherwise the currently-running stage.
    // The backend streams transcribing → diarizing; the frontend sets
    // 'formatting' itself before calling /api/getMarkdown.
    type Stage = null | 'decoding' | 'transcribing' | 'diarizing' | 'formatting';
    const [stage, setStage] = React.useState<Stage>(null);
    const [elapsed, setElapsed] = React.useState(0);
    // Whisper transcription progress (0–1). Populated from the NDJSON stream
    // every time a segment is decoded. null = the backend hasn't reported a
    // value yet, render the spinner alone (e.g. while ffmpeg decodes the
    // upload to WAV before Whisper starts).
    const [transcribeProgress, setTranscribeProgress] = React.useState<number | null>(null);
    const busy = stage !== null;
    const [markdown, setMarkdown] = React.useState('');
    // Streaming preview text from /api/getMarkdown. Updated on every NDJSON
    // chunk so the user sees the LLM's raw output materialize in real time,
    // without paying the cost of re-parsing markdown in MDXEditor each tick.
    // Cleared after the stream completes; the proper editor takes over.
    const [streamingPreview, setStreamingPreview] = React.useState('');
    const [microphoneKey, setMicrophoneKey] = React.useState(0);
    // Per-word Whisper probabilities. Populated from the /api/transcribe
    // complete event; used to highlight low-confidence stretches in the
    // raw transcript view AND persisted with the note so SingleNote can
    // keep showing them. We mirror state into a ref because the save chain
    // (transcribeRecording → getMarkdown → handleAddNewNote) runs inside an
    // async closure that was bound before setWhisperWords took effect —
    // reading the ref dodges that stale-closure trap.
    const [whisperWords, setWhisperWords] = React.useState<WordInfo[]>([]);
    const whisperWordsRef = React.useRef<WordInfo[]>([]);
    const updateWhisperWords = React.useCallback((next: WordInfo[]) => {
        whisperWordsRef.current = next;
        setWhisperWords(next);
    }, []);
    const [savingNote, setSavingNote] = React.useState(false);
    const [selectedTemplateName, setSelectedTemplateName] = React.useState('');
    const [selectedTemplateLlmModel, setSelectedTemplateLlmModel] = React.useState<string | null>(null);
    const [selectedTemplateType, setSelectedTemplateType] = React.useState<'simple' | 'structured'>('simple');

    // Per-field progress for structured-template runs. null while not running.
    type FieldStatus = 'pending' | 'running' | 'filled' | 'flagged' | 'skipped' | 'error';
    type FieldProgress = {
        label: string;
        status: FieldStatus;
        value?: string;
        confidence?: number;
        message?: string;
    };
    const [structuredProgress, setStructuredProgress] = React.useState<{
        mode: 'single-call' | 'per-field';
        fields: Record<string, FieldProgress>;
        order: string[];
    } | null>(null);
    const [currentParticipants, setCurrentParticipants] = React.useState<Participant[]>([]);
    // Installed Ollama models (name + size) for the per-note model picker, plus
    // the app-wide default the server reports. ollamaReachable: null = still
    // loading, true/false = whether the daemon answered.
    const [modelList, setModelList] = React.useState<{ name: string; parameter_size?: string }[]>([]);
    const [defaultModel, setDefaultModel] = React.useState<string | null>(null);
    const [ollamaReachable, setOllamaReachable] = React.useState<boolean | null>(null);
    // The model that will actually format this note. Defaults to the selected
    // template's saved model (or the app-wide default) and can be overridden
    // per note via the picker; sent to the backend on format.
    const [selectedModel, setSelectedModel] = React.useState<string | null>(null);
    const navigate = useNavigate();

    // Load installed models once so the picker can default to the template's
    // model and we can block recording before the user wastes time on a model
    // that isn't installed.
    useEffect(() => {
        const fetchModels = async () => {
            try {
                const response = await fetch(`${API_BASE}/api/ollama/models`, {
                    headers: { 'Authorization': `Bearer ${auth.token}` },
                });
                const data = await response.json().catch(() => ({}));
                // A 503 still carries the server's configured default; keep it so
                // the picker shows what *would* be used once Ollama is back.
                setDefaultModel(data.default || null);
                if (!response.ok) {
                    setModelList([]);
                    setOllamaReachable(false);
                    return;
                }
                setModelList(data.models || []);
                setOllamaReachable(true);
            } catch (err) {
                console.log('Error fetching installed models', err);
                setModelList([]);
                setDefaultModel(null);
                setOllamaReachable(false);
            }
        };
        fetchModels();
    }, [auth.token]);

    // Tick elapsed seconds while a stage is active. The dep is a primitive
    // boolean so transitioning between stages doesn't reset the timer — the
    // user sees one continuous "X:XX elapsed" across the pipeline.
    const isActive = stage !== null;
    React.useEffect(() => {
        if (!isActive) {
            setElapsed(0);
            return;
        }
        const start = Date.now();
        setElapsed(0);
        const id = setInterval(() => {
            setElapsed(Math.floor((Date.now() - start) / 1000));
        }, 250);
        return () => clearInterval(id);
    }, [isActive]);

    const installedNames = React.useMemo(() => modelList.map((m) => m.name), [modelList]);
    const haveInstalledModels = installedNames.length > 0;

    // Default the per-note model to the template's saved model (or the app-wide
    // default). Re-runs when the template changes — so switching templates
    // resets the picker to that template's model — or when the model list loads.
    useEffect(() => {
        setSelectedModel(selectedTemplateLlmModel || defaultModel || null);
    }, [selectedTemplateLlmModel, defaultModel]);

    // True only when the chosen model is confirmed installed.
    const modelAvailable =
        ollamaReachable === true && !!selectedModel && installedNames.includes(selectedModel);

    // Hard-block recording when we KNOW the model isn't available: Ollama is up
    // and has models, but the chosen one isn't among them — a fixable mismatch
    // (pick another). When Ollama is down or has no models at all there's
    // nothing to pick, so we don't block — we warn and still allow raw capture.
    const modelBlocksRecording =
        ollamaReachable === true &&
        haveInstalledModels &&
        !installedNames.includes(selectedModel || '');

    // Non-blocking "can't auto-format" state: Ollama down, or up with no models.
    const cannotFormat =
        ollamaReachable === false || (ollamaReachable === true && !haveInstalledModels);

    const handleAddNewNote = async (e: FormEvent, form: any) => {
        e.preventDefault();
        setSavingNote(true);
        const formValues = form.getValues();

        // Attach Whisper per-word probabilities for the persisted note so
        // the SingleNote page can render the confidence highlight overlay.
        // Not stored on the form because the field is ephemeral / not user-
        // editable.
        // Read from the ref, not the state. transcribeRecording → getMarkdown
        // → handleAddNewNote runs inside an async closure bound BEFORE the
        // setWhisperWords call returned, so closing over the state value
        // captures the empty initial array.
        const currentWords = whisperWordsRef.current;
        // Never lose a recording: if formatting produced no markdown (model
        // missing, Ollama down, cancelled, or a mid-stream error), persist the
        // raw transcript as the note body so the recording is always saveable.
        const markdownToSave =
            (formValues.noteContentMarkdown || '').trim().length > 0
                ? formValues.noteContentMarkdown
                : (formValues.noteContentRaw || '');
        const payload = {
            ...formValues,
            noteContentMarkdown: markdownToSave,
            noteContentWords: currentWords.length ? currentWords : null,
        };
        console.log(
            '[NewNoteForm save] whisperWordsRef len=', currentWords.length,
            'payload.noteContentWords len=', payload.noteContentWords?.length ?? 'null',
        );

        try {
            const response = await fetch(`${API_BASE}/api/notes`, {
                method: 'POST',
                headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${auth.token}`,
                },
                body: JSON.stringify(payload)
            });

            const data = await response.json();

            if (!response.ok) {
                console.error('Server response was not ok', data);
                throw new Error('Network request failed with status ' + response.status);
            } else {
                //note created
                //redirect to new note
                console.log('Note created:', data);
                navigate(`/notes/${data.id}`);
            }
        } catch (error) {
            console.log('Error submitting note: ', error)
            toast.error('Error submitting note. Please try again.');
        }
        setSavingNote(false);
    }

    const form = useForm({
        defaultValues: {
            authorId: auth.user?.id,
            authorName: auth.user?.firstName,
            // Optional user-supplied title for the notes table. Empty string
            // round-trips to a null DB column; the backend handles the
            // trim/blank-to-null normalization.
            name: '',
            participants: currentParticipants,
            noteDate: new Date(),
            noteContentRaw: '',
            noteContentMarkdown: '',
            noteContentSegments: null as null | { speaker: string; start: number; end: number; text: string }[],
            // Set by /api/transcribe response so the saved note can be linked
            // to its encrypted source audio. Stays empty for text-only notes.
            audioFileId: '' as string,
            noteTemplate: '',
            noteType: '',
            version: 1,
            status: 'draft',
        }
    });

    // Audio-capture settings and state (diarization / dictation / live-transcript
    // toggles, file upload, page-level drag-and-drop) now live in <AudioCapture>;
    // it hands a finished recording or chosen file back via onAudio() below.

    //update local state for template name + llm model when selected template id changes
    useEffect(() => {
        const currentTemplateId = form.watch('noteTemplate');
            if (currentTemplateId && templates) {
            const selectedTemplate = templates.find(template => template.id === currentTemplateId);
            if (selectedTemplate) {
                setSelectedTemplateName(selectedTemplate.name);
                setSelectedTemplateLlmModel(selectedTemplate.llmModel || null);
                setSelectedTemplateType(
                    selectedTemplate.templateType === 'structured' ? 'structured' : 'simple'
                );
            }
        }
    }, [form.watch('noteTemplate'), templates]);

    const handleCreateParticipant = async (newParticipant: NewParticipant): Promise<Participant> => {
        const response = await fetch(`${API_BASE}/api/participants`, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${auth.token}`,
        },
        body: JSON.stringify(newParticipant),
        });

        const data = await response.json();
        if (response.status === 400) {
            // Handle validation error
            console.error('Validation error:', data);
            throw new Error(data.error || 'Validation error');
        }
        
        if (!response.ok) {
            console.log('Failed to create participant:', data);
            throw new Error('Failed to create participant');
        }

        // Add the new participant to the current participants state
        const createdParticipant: Participant = {
            id: data.id,
            firstName: data.firstName,
            lastName: data.lastName,
            email: data.email,
        }

        setCurrentParticipants(prev => [...prev, createdParticipant]);

        return createdParticipant;
    };

    // A template is required before recording/uploading. Without one, the user
    // would burn minutes of CPU on whisper+diarization only to find out at the
    // formatting step that there's nothing to format against.
    const noteTemplate = form.watch('noteTemplate');
    const templateSelected = !!noteTemplate;
    // Recording is gated on a template AND (when verifiable) an installed model.
    const recordingDisabled = !templateSelected || modelBlocksRecording;

    const transcribeRecording = async (
        blob: Blob,
        filename: string = 'recording.webm',
        opts: CaptureOptions = { diarize: false, applyDictationMarkers: false },
    ) => {
        const { diarize, applyDictationMarkers } = opts;
        // Belt-and-suspenders: even if the disabled buttons are bypassed, refuse
        // to spend minutes on whisper+diarization without a template to format against.
        if (!form.getValues('noteTemplate')) {
            toast.error('Please select a template before recording or uploading audio.');
            return;
        }
        // Belt-and-suspenders: even if the disabled buttons are bypassed, refuse
        // to record against a model we know isn't installed.
        if (modelBlocksRecording) {
            toast.error(`The model "${selectedModel}" isn't installed. Pick an installed model before recording.`);
            return;
        }

        setStage('transcribing');
        setTranscribeProgress(null);
        const formData = new FormData();
        // Backend uses the filename's extension to pick a pydub decoder, so we
        // pass through the real filename for uploads (mp3/m4a/wav/...) and
        // default to recording.webm for live MediaRecorder blobs.
        formData.append('file', blob, filename);
        formData.append('diarize', diarize ? 'true' : 'false');
        formData.append('apply_dictation_markers', applyDictationMarkers ? 'true' : 'false');

        // Hint pyannote with an upper bound on speaker count when we have
        // a participant list. The backend treats this as max_speakers (not
        // exact) so over-listing is safe — pyannote can still settle on
        // fewer if not everyone spoke.
        const participantCount = (form.getValues('participants') ?? []).length;
        if (diarize && participantCount > 0) {
            formData.append('max_speakers', String(participantCount));
        }

        console.log('Uploading audio for transcription...', filename, blob, 'diarize:', diarize, 'max_speakers:', participantCount || 'auto');
        try {
            const response = await fetch(`${API_BASE}/api/transcribe`, {
                method: 'POST',
                headers: {
                    "Authorization": `Bearer ${auth.token}`,
                },
                body: formData,
            });

            // 413 is enforced by Flask before our handler runs and comes back
            // as a normal (non-streamed) response, so handle it before reading
            // the body as a stream.
            if (response.status === 413) {
                const errBody = await response.json().catch(() => ({}));
                toast.error(errBody.message || 'That file is too large to upload.');
                setStage(null);
                return;
            }

            if (!response.ok || !response.body) {
                const errBody = await response.json().catch(() => ({}));
                throw new Error(errBody.error || `Server error: ${response.status}`);
            }

            // Consume the NDJSON stream. Each line is one JSON event; the last
            // event is either {stage: "complete", ...} or {stage: "error", ...}.
            // We have to buffer across chunks because a JSON object can span
            // network reads.
            type ProgressEvent = { stage: 'decoding' | 'transcribing' | 'diarizing'; progress?: number };
            type TerminalEvent =
                | { stage: 'complete'; raw_note: string; segments: { speaker: string; start: number; end: number; text: string }[] | null; words?: WordInfo[]; audio_file_id?: string }
                | { stage: 'error'; error?: string; message?: string; raw_note?: string; words?: WordInfo[]; audio_file_id?: string };
            type StageEvent = ProgressEvent | TerminalEvent;

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let finalEvent: TerminalEvent | null = null;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';
                for (const line of lines) {
                    if (!line.trim()) continue;
                    let evt: StageEvent;
                    try {
                        evt = JSON.parse(line) as StageEvent;
                    } catch (e) {
                        console.error('Bad NDJSON line from /api/transcribe:', line, e);
                        continue;
                    }
                    if (evt.stage === 'decoding' || evt.stage === 'transcribing' || evt.stage === 'diarizing') {
                        setStage(evt.stage);
                        if (evt.stage === 'transcribing' && typeof (evt as any).progress === 'number') {
                            setTranscribeProgress((evt as any).progress);
                        }
                    } else {
                        // 'complete' or 'error' — terminal events. We don't
                        // break here because the server should have closed the
                        // stream right after; the next read() returns done.
                        finalEvent = evt as TerminalEvent;
                    }
                }
            }
            // Flush any trailing line (server should always end with \n, but
            // guard anyway).
            if (buffer.trim()) {
                try { finalEvent = JSON.parse(buffer) as TerminalEvent; } catch { /* ignore */ }
            }

            if (!finalEvent) {
                throw new Error('Transcription stream ended without a result');
            }

            // Diarization-unavailable: fall back to the flat transcript and
            // keep going to the formatting step (matches old 422 behavior).
            if (finalEvent.stage === 'error' && finalEvent.error === 'diarization_unavailable') {
                console.warn('Diarization unavailable, falling back to flat transcript:', finalEvent.message);
                toast.error(
                    `Speaker identification is unavailable: ${finalEvent.message || 'pipeline not configured'}\n\n` +
                    `Continuing with a single-speaker transcript. Uncheck "Identify speakers" to skip this warning.`
                );
                if (finalEvent.raw_note) {
                    form.setValue('noteContentRaw', finalEvent.raw_note);
                    form.setValue('noteContentSegments', null);
                    if (finalEvent.audio_file_id) form.setValue('audioFileId', finalEvent.audio_file_id);
                    updateWhisperWords(finalEvent.words ?? []);
                    setStage('formatting');
                    await getMarkdown(finalEvent.raw_note);
                } else {
                    setStage(null);
                }
                return;
            }

            if (finalEvent.stage === 'error') {
                throw new Error(finalEvent.message || finalEvent.error || 'Transcription failed');
            }

            console.log('Transcription Result:', finalEvent);

            if (finalEvent.raw_note === '') {
                toast.error('Transcription unable to identify speech. Please try again.');
                setStage(null);
                return;
            }

            form.setValue('noteContentRaw', finalEvent.raw_note);
            form.setValue('noteContentSegments', finalEvent.segments ?? null);
            if (finalEvent.audio_file_id) form.setValue('audioFileId', finalEvent.audio_file_id);
            // Stash per-word confidences (only present on the non-diarized
            // path for v1). Empty array clears any previous run's data.
            updateWhisperWords(finalEvent.words ?? []);

            // Hand off to the formatting stage. getMarkdown clears stage in
            // its finally block, so we don't clear it here.
            setStage('formatting');
            await getMarkdown(finalEvent.raw_note);
        } catch (error: any) {
            console.error('Upload failed:', error);
            toast.error(`Upload failed: ${error.message}`);
            setStage(null);
        }
    }

    const getMarkdownStructured = async (rawNote: string, signal?: AbortSignal) => {
        // Streaming path for structured (Studio) templates. Backend may run
        // single-call (one Ollama round-trip, one `complete` event) or
        // per-field (one event per field, then `complete`) depending on the
        // template's effective strictness. Frontend treats both the same way:
        // consume events, render progress, take the final markdown.
        try {
            const res = await fetch(`${API_BASE}/api/notes/run-structured`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${auth.token}`,
                },
                signal,
                body: JSON.stringify({
                    raw_note: rawNote,
                    template_id: form.getValues('noteTemplate'),
                    // Per-note model override; backend falls back to the
                    // template/app default when empty.
                    model: selectedModel || undefined,
                    note_details: {
                        note_date: form.getValues('noteDate'),
                        author_id: form.getValues('authorId'),
                        template_id: form.getValues('noteTemplate'),
                        participants: form.getValues('participants'),
                    },
                }),
            });

            // Non-stream error responses (preflight rejections).
            if (!res.ok || !res.body) {
                const errBody = await res.json().catch(() => ({}));
                if (res.status === 503) flagOllamaDown();
                if (res.status === 422 && errBody.error === 'model_not_installed') {
                    fallBackToRawTranscript(rawNote);
                    toast.error(errBody.message || `Model '${errBody.model}' isn't installed.`);
                    return;
                }
                throw new Error(errBody.error || `Server error: ${res.status}`);
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let finalMarkdown: string | null = null;
            let errorMessage: string | null = null;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';
                for (const line of lines) {
                    if (!line.trim()) continue;
                    let evt: any;
                    try {
                        evt = JSON.parse(line);
                    } catch (e) {
                        console.error('Bad NDJSON line from run-structured:', line, e);
                        continue;
                    }
                    if (evt.stage === 'started') {
                        setStructuredProgress({ mode: evt.mode, fields: {}, order: [] });
                    } else if (evt.stage === 'field_start') {
                        setStructuredProgress((prev) => {
                            if (!prev) return prev;
                            return {
                                ...prev,
                                order: prev.order.includes(evt.fieldId) ? prev.order : [...prev.order, evt.fieldId],
                                fields: {
                                    ...prev.fields,
                                    [evt.fieldId]: { label: evt.label || evt.variableKey, status: 'running' },
                                },
                            };
                        });
                    } else if (evt.stage === 'field_complete') {
                        setStructuredProgress((prev) => {
                            if (!prev) return prev;
                            const existing = prev.fields[evt.fieldId] || { label: evt.fieldId, status: 'pending' as FieldStatus };
                            return {
                                ...prev,
                                fields: {
                                    ...prev.fields,
                                    [evt.fieldId]: {
                                        ...existing,
                                        status: evt.flagged ? 'flagged' : 'filled',
                                        value: evt.value,
                                        confidence: evt.confidence,
                                    },
                                },
                            };
                        });
                    } else if (evt.stage === 'field_skipped') {
                        setStructuredProgress((prev) => {
                            if (!prev) return prev;
                            return {
                                ...prev,
                                order: prev.order.includes(evt.fieldId) ? prev.order : [...prev.order, evt.fieldId],
                                fields: {
                                    ...prev.fields,
                                    [evt.fieldId]: { label: evt.fieldId, status: 'skipped' },
                                },
                            };
                        });
                    } else if (evt.stage === 'field_error') {
                        setStructuredProgress((prev) => {
                            if (!prev) return prev;
                            const existing = prev.fields[evt.fieldId] || { label: evt.fieldId, status: 'pending' as FieldStatus };
                            return {
                                ...prev,
                                fields: {
                                    ...prev.fields,
                                    [evt.fieldId]: { ...existing, status: 'error', message: evt.message },
                                },
                            };
                        });
                    } else if (evt.stage === 'complete') {
                        finalMarkdown = evt.markdown as string;
                    } else if (evt.stage === 'error') {
                        errorMessage = evt.message || 'Structured run failed';
                    }
                }
            }

            if (errorMessage) {
                // Keep the recording: drop the raw transcript into the editor
                // so the user can save it manually instead of losing it.
                fallBackToRawTranscript(rawNote);
                toast.error(`Structured run failed: ${errorMessage}`);
                return;
            }
            if (finalMarkdown === null) {
                fallBackToRawTranscript(rawNote);
                toast.error('Structured run ended without a final markdown payload. Showing the raw transcript so you can edit and save it.');
                return;
            }

            form.setValue('noteContentMarkdown', finalMarkdown);
            mdxEditorRef.current?.setMarkdown(finalMarkdown);
            setMarkdown(finalMarkdown);
            handleAddNewNote({ preventDefault: () => {} } as React.FormEvent, form);
        } catch (e: any) {
            if (e?.name === 'AbortError') {
                // Bubble up so getMarkdown's catch shows the cancel/fallback path.
                throw e;
            }
            console.error('Structured formatting failed:', e);
            // Keep the recording: fall back to the raw transcript so it can be
            // saved manually rather than lost.
            fallBackToRawTranscript(rawNote);
            toast.error(`Formatting failed: ${e.message}. Showing the raw transcript so you can edit and save it.`);
        }
    };

    // Drop the raw transcript into the editor (without auto-saving) so the user
    // can edit/save by hand. Shared by the 422/503/cancel fallbacks.
    const fallBackToRawTranscript = (rawNote: string) => {
        form.setValue('noteContentMarkdown', rawNote);
        mdxEditorRef.current?.setMarkdown(rawNote);
        setMarkdown(rawNote);
        // Drop any in-flight streaming preview so it doesn't linger over the
        // fallback view.
        setStreamingPreview('');
    };

    const cancelFormatting = () => {
        formattingAbortRef.current?.abort();
    };

    const getMarkdown = async (rawNote: string) => {
        // Caller sets stage='formatting' before invoking this so the spinner
        // label is correct from the moment the request goes out. We only
        // need to clear it in our finally.
        setStage('formatting');
        form.setValue('noteContentMarkdown', '');
        mdxEditorRef.current?.setMarkdown('');

        const controller = new AbortController();
        formattingAbortRef.current = controller;

        try {
            // Branch on the picked template's type. Structured templates run on
            // a different endpoint that streams per-field progress.
            if (selectedTemplateType === 'structured') {
                await getMarkdownStructured(rawNote, controller.signal);
                return;
            }

            const response = await fetch(`${API_BASE}/api/getMarkdown`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${auth.token}`,
                },
                signal: controller.signal,
                body: JSON.stringify({
                    raw_note: rawNote,
                    // Per-note model override; backend falls back to the
                    // template/app default when empty.
                    model: selectedModel || undefined,
                    note_details: {
                        note_date: form.getValues('noteDate'),
                        author_id: form.getValues('authorId'),
                        template_id: form.getValues('noteTemplate'),
                        participants: form.getValues('participants')
                    }
                 }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                // 422 = template's assigned model isn't installed in Ollama. Same
                // raw-transcript fallback as 503, but with a clearer message that
                // tells the operator which model is missing.
                if (response.status === 422 && errorData.error === 'model_not_installed') {
                    fallBackToRawTranscript(errorData.raw_note || rawNote);
                    toast.error(errorData.message || `The model '${errorData.model}' isn't installed. An admin needs to pull it before this template can be used.`);
                    return;
                }
                if (response.status === 503) {
                    // Ollama unavailable (down, model missing, or our request
                    // timeout fired) — fall back to the raw transcript so the
                    // user can edit/save manually instead of losing the recording.
                    flagOllamaDown();
                    fallBackToRawTranscript(errorData.raw_note || rawNote);
                    toast.error(errorData.error || 'AI formatting unavailable. Showing the raw transcript so you can edit and save manually.');
                    return; // don't auto-save; let the user review
                }
                throw new Error(errorData.error || `Server error: ${response.status}`);
            }

            // NDJSON stream: chunks arrive incrementally, terminal event carries
            // the joined final markdown. We render the accumulating text in a
            // read-only "peek under the hood" preview pane (cheap) and only
            // hand off to MDXEditor once at the end (expensive re-parse).
            if (!response.body) throw new Error('Markdown stream had no body');
            setStreamingPreview('');
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let accumulated = '';
            let finalMarkdown: string | null = null;
            let streamError: string | null = null;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';
                for (const line of lines) {
                    if (!line.trim()) continue;
                    let evt: any;
                    try { evt = JSON.parse(line); } catch (e) {
                        console.error('Bad NDJSON line from /api/getMarkdown:', line, e);
                        continue;
                    }
                    if (evt.stage === 'chunk' && typeof evt.delta === 'string') {
                        accumulated += evt.delta;
                        setStreamingPreview(accumulated);
                    } else if (evt.stage === 'complete' && typeof evt.markdown === 'string') {
                        finalMarkdown = evt.markdown;
                    } else if (evt.stage === 'error') {
                        streamError = evt.message || 'AI formatting failed mid-stream.';
                    }
                    // 'start' is informational; ignored.
                }
            }
            if (buffer.trim()) {
                try {
                    const evt = JSON.parse(buffer);
                    if (evt.stage === 'complete' && typeof evt.markdown === 'string') {
                        finalMarkdown = evt.markdown;
                    } else if (evt.stage === 'error') {
                        streamError = evt.message || 'AI formatting failed mid-stream.';
                    }
                } catch { /* ignore */ }
            }

            if (streamError) {
                setStreamingPreview('');
                flagOllamaDown();
                fallBackToRawTranscript(rawNote);
                toast.error(streamError);
                return;
            }
            if (finalMarkdown === null) {
                // Stream ended without a complete event. Treat the accumulator
                // as the result so the user doesn't lose what came through.
                finalMarkdown = accumulated;
            }

            // Hand off to the real editor once. Clearing the preview here
            // would cause a brief flash; we clear it in the finally block of
            // getMarkdown after stage transitions away.
            form.setValue('noteContentMarkdown', finalMarkdown);
            mdxEditorRef.current?.setMarkdown(finalMarkdown);
            setMarkdown(finalMarkdown);
            setStreamingPreview('');

            //save note
            handleAddNewNote({ preventDefault: () => {} } as React.FormEvent, form);
        } catch (error: any) {
            if (error?.name === 'AbortError') {
                // User hit Cancel. Keep the recording — show the raw transcript
                // for hand-editing, same as the 503 path. (Note the backend
                // request keeps running to completion; we just stop waiting.)
                fallBackToRawTranscript(rawNote);
                toast('Formatting cancelled. Showing the raw transcript so you can edit and save it manually.');
            } else {
                console.error('Failed to get markdown:', error);
                // Keep the recording: fall back to the raw transcript so it can
                // be saved manually rather than lost.
                fallBackToRawTranscript(rawNote);
                toast.error(`Formatting failed: ${error.message}. Showing the raw transcript so you can edit and save it.`);
            }
        } finally {
            formattingAbortRef.current = null;
            setStage(null);
            // Keep structuredProgress around so the user can see the final
            // per-field summary even after the run completes; the form reset /
            // new-note action clears it.
        }
    }

  return (
    <Form {...form}>
    <form onSubmit={(e) => handleAddNewNote(e, form)}>
        <div className="flex flex-col gap-4">
            {/* Optional name for at-a-glance discovery on the All Notes
                table. Empty round-trips to a null DB column; the backend
                trims + nulls blank strings. */}
            <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>Name <span className="text-xs text-muted-foreground font-normal">(optional)</span></FormLabel>
                        <FormControl>
                            <Input
                                {...field}
                                placeholder="e.g. Landlord call, Q2 review prep"
                                maxLength={120}
                            />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )}
            />
            <fieldset className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                <FormField
                    control={form.control}
                    name="noteTemplate"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Note Template</FormLabel>
                            <FormControl>
                                <Select
                                    onValueChange={(value) => {
                                        field.onChange(value);
                                        const selectedTemplate = templates.find(t => t.id === value);
                                        if (selectedTemplate) {
                                            setSelectedTemplateName(selectedTemplate.name);
                                            setSelectedTemplateLlmModel(selectedTemplate.llmModel || null);
                                            setSelectedTemplateType(
                                                selectedTemplate.templateType === 'structured' ? 'structured' : 'simple'
                                            );
                                        }
                                    }}
                                    value={field.value}
                                >
                                    <SelectTrigger className='z-10 bg-white [&>span]:line-clamp-none [&>span]:overflow-visible'>
                                        <SelectValue placeholder="Select a template">
                                            {selectedTemplateName ? (
                                                <>
                                                    <span
                                                        className={
                                                            'mr-2 inline-block align-middle border-2 px-1.5 py-px text-[9px] font-extrabold uppercase tracking-wider ' +
                                                            (selectedTemplateType === 'structured'
                                                                ? 'border-[#5d1d91] bg-[#5d1d91] text-white'
                                                                : 'border-black bg-white text-black')
                                                        }
                                                        title={
                                                            selectedTemplateType === 'structured'
                                                                ? 'Built in PrivateScribe Studio (structured fields)'
                                                                : 'Markdown template'
                                                        }
                                                    >
                                                        {selectedTemplateType === 'structured' ? 'Studio' : 'Simple'}
                                                    </span>
                                                    <span className='align-middle'>{selectedTemplateName}</span>
                                                </>
                                            ) : (
                                                'Select a template'
                                            )}
                                        </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent className='z-10 bg-white'>
                                        {templates.map((template: any) => {
                                            const isStudio = template.templateType === 'structured';
                                            return (
                                                <SelectItem
                                                    key={template.id}
                                                    value={template.id}
                                                    className='hover:bg-[#fd3777]'
                                                >
                                                    <span className='flex items-center gap-2'>
                                                        <span
                                                            className={
                                                                'inline-flex border px-1 py-px text-[9px] font-extrabold uppercase tracking-wider ' +
                                                                (isStudio
                                                                    ? 'border-[#5d1d91] bg-[#5d1d91] text-white'
                                                                    : 'border-black bg-white text-black')
                                                            }
                                                        >
                                                            {isStudio ? 'Studio' : 'Simple'}
                                                        </span>
                                                        {template.name}
                                                    </span>
                                                </SelectItem>
                                            );
                                        })}
                                    </SelectContent>
                                </Select>
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField 
                    control={form.control} 
                    name="noteDate" 
                    render={({ field }) => (
                        <FormItem className="flex flex-col justify-start">
                            <FormLabel>Note Date</FormLabel>
                            <FormControl>
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button variant="outline" color="primary" size="sm">
                                            {field.value ? format(field.value, "PPP") : <span>Select a date</span>}
                                            <CalendarIcon />
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0 z-10 bg-white">
                                        <Calendar
                                            mode="single"
                                            selected={field.value}
                                            onSelect={field.onChange}
                                            disabled={(date) => date > new Date() || date < new Date("1900-01-01")}
                                        />
                                    </PopoverContent>
                                </Popover>
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            </fieldset>
            {templateSelected && (
                <fieldset className="flex flex-col gap-1">
                    <FormLabel>
                        AI Model{' '}
                        <span className="text-xs text-muted-foreground font-normal">
                            (defaults to the template's model)
                        </span>
                    </FormLabel>
                    <Select
                        // Show the chosen model only when it's actually installed;
                        // otherwise fall to the placeholder so the user is prompted
                        // to pick a real one.
                        value={modelAvailable ? (selectedModel as string) : ''}
                        onValueChange={(v) => setSelectedModel(v)}
                        disabled={ollamaReachable !== true || !haveInstalledModels}
                    >
                        <SelectTrigger className="z-10 bg-white">
                            <SelectValue
                                placeholder={
                                    ollamaReachable === null
                                        ? 'Loading models…'
                                        : ollamaReachable === false
                                          ? 'Ollama offline — formatting unavailable'
                                          : !haveInstalledModels
                                            ? 'No models installed'
                                            : 'Select an installed model'
                                }
                            />
                        </SelectTrigger>
                        <SelectContent className="z-10 bg-white">
                            {modelList.map((m) => (
                                <SelectItem key={m.name} value={m.name} className="hover:bg-[#fd3777]">
                                    {m.name}
                                    {m.parameter_size ? ` (${m.parameter_size})` : ''}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {cannotFormat && (
                        <div className="border-2 border-black bg-yellow-100 p-3 text-sm mt-1">
                            <strong>Heads up:</strong>{' '}
                            {ollamaReachable === false
                                ? "Ollama is offline, so notes can't be auto-formatted right now."
                                : "No AI models are installed, so notes can't be auto-formatted yet."}{' '}
                            You can still record — your transcript is saved raw and can be formatted later.
                        </div>
                    )}
                </fieldset>
            )}
            <fieldset className="flex flex-col gap-2">
                <FormField
                    control={form.control}
                    name="participants"
                    render={({ field }) => (
                        <FormItem className="flex flex-col">
                        {/* <FormLabel>Participants</FormLabel> */}
                        <FormControl>
                            <ParticipantSelector
                                selectedParticipants={field.value}
                                onChange={(field.onChange)}
                                onCreateParticipant={handleCreateParticipant}
                                onDeleteParticipant={() => console.log('Participant delete not implemented')}
                                disabled={false}
                                savedParticipants={savedParticipants}
                            />
                        </FormControl>
                        <FormMessage />
                        </FormItem>
                    )}
                    />
            </fieldset>
        </div>

        {/* Audio source: the shared capture experience (diarize / dictation /
            live-transcript toggles + Record/Upload tabs + drag-and-drop). On a
            finished recording or chosen file it calls back into our transcribe
            pipeline. Gated on a template being selected. */}
        <AudioCapture
            authToken={auth.token}
            busy={busy}
            disabled={recordingDisabled}
            disabledNotice={
                modelBlocksRecording ? (
                    <div className="border-2 border-black bg-red-100 p-3 text-sm mt-4">
                        <strong>Recording disabled.</strong> The model
                        <code className="mx-1 px-1 bg-white border border-black">{selectedModel}</code>
                        {selectedTemplateLlmModel === selectedModel ? 'set on this template ' : ''}
                        isn't installed in Ollama. Pick an installed model above to enable recording,
                        or pull it from the Admin → Models page.
                    </div>
                ) : (
                    <div className="border-2 border-black bg-yellow-100 p-3 text-sm mt-4">
                        <strong>Pick a template above first.</strong> Recording and uploading are
                        disabled until a template is selected — otherwise the transcript can't be
                        auto-formatted.
                    </div>
                )
            }
            showDictationToggle={!!auth.user?.dictationMarkersEnabled}
            resetSignal={microphoneKey}
            onAudio={(blob, filename, opts) => transcribeRecording(blob, filename, opts)}
        />

        {/* Pipeline progress: spinner + current stage label + elapsed time.
            Stage transitions are driven by the NDJSON stream from /api/transcribe
            (transcribing → diarizing) and by the frontend before /api/getMarkdown
            (formatting). */}
        {stage && (
            <div className="flex flex-col w-full justify-center items-center mt-4 gap-1">
                <div className="flex items-center gap-2">
                    <span className="inline-block h-4 w-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                    <span>
                        {stage === 'decoding' && 'Decoding audio (ffmpeg)...'}
                        {stage === 'transcribing' && 'Transcribing audio (Whisper)...'}
                        {stage === 'diarizing' && 'Identifying speakers (pyannote)...'}
                        {stage === 'formatting' && 'Formatting note (LLM)...'}
                    </span>
                </div>
                {/* Determinate progress bar for Whisper. The other stages have
                    no good progress signal (pyannote runs as a single pass;
                    LLM token count is unknown ahead of time), so they keep
                    the spinner-only treatment. */}
                {stage === 'transcribing' && transcribeProgress !== null && (
                    <div className="w-64 mt-1">
                        <div className="h-2 border-2 border-black bg-white overflow-hidden">
                            <div
                                className="h-full bg-[#fd3777]"
                                style={{
                                    width: `${Math.min(100, Math.round(transcribeProgress * 100))}%`,
                                    transition: 'width 120ms linear',
                                }}
                            />
                        </div>
                        <div className="text-[10px] text-gray-600 tabular-nums text-center mt-0.5">
                            {Math.round(transcribeProgress * 100)}%
                        </div>
                    </div>
                )}
                <span className="text-xs text-gray-600 tabular-nums">
                    {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')} elapsed
                </span>
                {stage === 'formatting' && (
                    <button
                        type="button"
                        onClick={cancelFormatting}
                        className="mt-1 text-xs font-bold uppercase tracking-wider underline text-[#fd3777] hover:text-black"
                    >
                        Cancel — keep raw transcript
                    </button>
                )}
            </div>
        )}

        {/* Live preview of the streaming LLM output. Plain-text so re-rendering
            is cheap; replaced by the proper MDXEditor once the stream completes. */}
        {stage === 'formatting' && streamingPreview && (
            <div className="mt-4 border-2 border-black bg-[#1a1a1a] text-[#e5e5e5] p-4 font-mono text-xs">
                <div className="flex items-center justify-between mb-2">
                    <h3 className="text-[11px] font-bold uppercase tracking-wider text-[#fd3777]">
                        Generating note…
                    </h3>
                    <span className="text-[10px] uppercase tracking-wider text-gray-500">
                        Peek under the hood
                    </span>
                </div>
                <pre className="whitespace-pre-wrap break-words max-h-72 overflow-y-auto leading-snug">
                    {streamingPreview}
                </pre>
            </div>
        )}

        {structuredProgress && (
            <div className="mt-4 border-2 border-black bg-white p-4">
                <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-black uppercase tracking-wider">
                        Field-by-field run ({structuredProgress.mode})
                    </h3>
                    <button
                        type="button"
                        onClick={() => setStructuredProgress(null)}
                        className="text-xs text-muted-foreground hover:text-black"
                    >
                        Hide
                    </button>
                </div>
                <ul className="space-y-1 text-sm">
                    {structuredProgress.order.map((fid) => {
                        const f = structuredProgress.fields[fid];
                        if (!f) return null;
                        const icon = {
                            pending: '○',
                            running: '◴',
                            filled: '✓',
                            flagged: '⚠',
                            skipped: '—',
                            error: '✗',
                        }[f.status];
                        const color = {
                            pending: 'text-muted-foreground',
                            running: 'text-blue-600',
                            filled: 'text-green-700',
                            flagged: 'text-amber-600',
                            skipped: 'text-muted-foreground',
                            error: 'text-red-600',
                        }[f.status];
                        return (
                            <li key={fid} className="flex items-start gap-2">
                                <span className={`font-mono ${color}`}>{icon}</span>
                                <span className="font-semibold">{f.label}</span>
                                {f.status === 'filled' && f.value && (
                                    <span className="text-muted-foreground truncate">— {f.value}</span>
                                )}
                                {f.status === 'flagged' && (
                                    <span className="text-amber-600 text-xs">low-confidence, flagged for review</span>
                                )}
                                {f.status === 'skipped' && (
                                    <span className="text-muted-foreground text-xs">manual entry</span>
                                )}
                                {f.status === 'error' && f.message && (
                                    <span className="text-red-600 text-xs">{f.message}</span>
                                )}
                            </li>
                        );
                    })}
                </ul>
            </div>
        )}


        {/* Tabs Component for Raw Transcript and Markdown Editor */}
        {/* only show tabs when there is a raw transcript and markdown */}
        {form.getValues("noteContentRaw") != '' && (
        <Tabs defaultValue="markdown" className="w-full mt-4">
            <TabsList className="flex w-full">
                <TabsTrigger className='grow' value="markdown">Markdown Editor</TabsTrigger>
                <TabsTrigger className='grow' value="transcript">Raw Transcript</TabsTrigger>
            </TabsList>

            <TabsContent value="markdown">
                    <MarkdownEditor
                        className="w-full mt-4"
                        plugins={[
                            headingsPlugin(),
                            quotePlugin(),
                            listsPlugin(),
                            toolbarPlugin({
                                toolbarClassName: "flex gap-2 w-full",
                                toolbarContents: () => (
                                    <>
                                        <UndoRedo />
                                        <BoldItalicUnderlineToggles />
                                        <ListsToggle />
                                    </>
                                )
                            })
                        ]}
                        editorRef={mdxEditorRef}
                        placeholder="Formatted note will appear here after dictation..."
                        readOnly={stage === 'formatting'}
                        markdown={form.getValues("noteContentMarkdown")}
                        onChange={(value) => {
                            form.setValue("noteContentMarkdown", value);
                            setMarkdown(value);
                        }}
                    />
            </TabsContent>

            <TabsContent value="transcript">
                {form.getValues("noteContentSegments") ? (
                    <div className="flex flex-col mt-4 gap-1">
                        <FormLabel>Raw Transcription</FormLabel>
                        <div className="border-2 border-black bg-white p-3 max-h-96 overflow-y-auto">
                            {form.getValues("noteContentSegments")!.map((s, i) => (
                                <div key={i} className="mb-2 last:mb-0">
                                    <span className="font-semibold text-[#fd3777]">{s.speaker}:</span>{' '}
                                    <span>{s.text}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col mt-4 gap-1">
                        <div className="flex items-baseline justify-between">
                            <FormLabel>Raw Transcription</FormLabel>
                            {whisperWords.length > 0 && (() => {
                                const low = countLowConfidence(whisperWords);
                                return low > 0 ? (
                                    <span className="text-xs text-muted-foreground">
                                        <span
                                            className="inline-block align-middle mr-1"
                                            style={{
                                                width: 10,
                                                height: 10,
                                                backgroundColor: '#fff3a0',
                                                border: '1px solid #b78400',
                                            }}
                                        />
                                        {low} word{low === 1 ? '' : 's'} flagged for review
                                    </span>
                                ) : null;
                            })()}
                        </div>
                        <div className="border-2 border-black bg-white p-3 max-h-96 overflow-y-auto text-sm">
                            {whisperWords.length > 0 ? (
                                <ConfidenceText
                                    text={form.getValues('noteContentRaw') || ''}
                                    words={whisperWords}
                                />
                            ) : (
                                <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                    {form.getValues('noteContentRaw')}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </TabsContent>
        </Tabs>
        )}
        
        {/* Buttons */}
        {savingNote && (
            <div className="flex flex-col w-full justify-center items-center mt-4">
                <p className="text-primary">Saving note...</p>
            </div>
        )}
        {/* Show Save as soon as there's a transcript and the pipeline is idle —
            even if AI formatting failed, was cancelled, or no model was
            available. handleAddNewNote falls back to saving the raw transcript
            as the body, so a recording is never stranded unsaveable. */}
        {!savingNote && !busy && form.getValues("noteContentRaw") && (
        <div className='flex justify-center items-center gap-4 mt-4'>
            <NeoButton 
                type="submit"
                disabled={form.getValues("noteContentRaw") === ''}
            >
                Save Note
            </NeoButton>
            <NeoButton 
                type="button"
                onClick={() => {
                    form.reset();
                    setMarkdown('');
                    mdxEditorRef.current?.setMarkdown('');
                    setMicrophoneKey(microphoneKey + 1);
                }}
            >
                Reset
            </NeoButton>
        </div>
        )}
    </form>

</Form>

  )
}

export default NewNoteForm