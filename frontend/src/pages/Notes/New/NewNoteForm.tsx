import React, { FormEvent, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { format } from 'date-fns'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { CalendarIcon } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import Microphone from '@/components/recording/microphone'
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
    // Single pipeline state: null = idle, otherwise the currently-running stage.
    // The backend streams transcribing → diarizing; the frontend sets
    // 'formatting' itself before calling /api/getMarkdown.
    type Stage = null | 'transcribing' | 'diarizing' | 'formatting';
    const [stage, setStage] = React.useState<Stage>(null);
    const [elapsed, setElapsed] = React.useState(0);
    const busy = stage !== null;
    const [markdown, setMarkdown] = React.useState('');
    const [microphoneKey, setMicrophoneKey] = React.useState(0);
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
    const [installedModels, setInstalledModels] = React.useState<string[] | null>(null);
    const navigate = useNavigate();

    // Load installed models once so we can flag templates whose LLM is missing
    // before the user spends time recording. null = still loading; empty array
    // = Ollama reachable but no models; we treat unreachable the same as empty
    // since the actual /api/getMarkdown call will surface a 503 either way.
    useEffect(() => {
        const fetchModels = async () => {
            try {
                const response = await fetch('http://127.0.0.1:5000/api/ollama/models', {
                    headers: { 'Authorization': `Bearer ${auth.token}` },
                });
                const data = await response.json();
                const names = (data.models || []).map((m: any) => m.name);
                setInstalledModels(names);
            } catch (err) {
                console.log('Error fetching installed models', err);
                setInstalledModels([]);
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

    const modelMissing =
        !!selectedTemplateLlmModel &&
        installedModels !== null &&
        !installedModels.includes(selectedTemplateLlmModel);

    const handleAddNewNote = async (e: FormEvent, form: any) => {
        e.preventDefault();
        setSavingNote(true);
        const formValues = form.getValues();


        try {
            const response = await fetch('http://127.0.0.1:5000/api/notes', {
                method: 'POST',
                headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${auth.token}`,
                },
                body: JSON.stringify(formValues)
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
            alert('Error submitting note. Please try again.');
        }
        setSavingNote(false);
    }

    const form = useForm({
        defaultValues: {
            authorId: auth.user?.id,
            authorName: auth.user?.firstName,
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

    // Diarization is a UX choice, not a persisted note field — hold it in
    // local state so it isn't sent to /api/notes alongside form values.
    const [diarize, setDiarize] = React.useState(true);

    // File-upload-as-source state. Distinct from the Microphone path so the
    // user can preview before kicking off transcription.
    const [uploadedFile, setUploadedFile] = React.useState<File | null>(null);
    const [uploadedAudioUrl, setUploadedAudioUrl] = React.useState<string | null>(null);
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    React.useEffect(() => {
        // Free the object URL when the file changes/unmounts to avoid leaks.
        return () => {
            if (uploadedAudioUrl) URL.revokeObjectURL(uploadedAudioUrl);
        };
    }, [uploadedAudioUrl]);

    const handleFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (uploadedAudioUrl) URL.revokeObjectURL(uploadedAudioUrl);
        setUploadedFile(file);
        setUploadedAudioUrl(URL.createObjectURL(file));
    };

    const handleTranscribeUpload = () => {
        if (!uploadedFile) return;
        transcribeRecording(uploadedFile, uploadedFile.name);
    };

    const clearUploadedFile = () => {
        if (uploadedAudioUrl) URL.revokeObjectURL(uploadedAudioUrl);
        setUploadedFile(null);
        setUploadedAudioUrl(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

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
        const response = await fetch('http://127.0.0.1:5000/api/participants', {
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

    const transcribeRecording = async (blob: Blob, filename: string = 'recording.webm') => {
        // Belt-and-suspenders: even if the disabled buttons are bypassed, refuse
        // to spend minutes on whisper+diarization without a template to format against.
        if (!form.getValues('noteTemplate')) {
            alert('Please select a template before recording or uploading audio.');
            return;
        }

        setStage('transcribing');
        const formData = new FormData();
        // Backend uses the filename's extension to pick a pydub decoder, so we
        // pass through the real filename for uploads (mp3/m4a/wav/...) and
        // default to recording.webm for live MediaRecorder blobs.
        formData.append('file', blob, filename);
        formData.append('diarize', diarize ? 'true' : 'false');

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
            const response = await fetch('http://127.0.0.1:5000/api/transcribe', {
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
                alert(errBody.message || 'That file is too large to upload.');
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
            type ProgressEvent = { stage: 'transcribing' | 'diarizing' };
            type TerminalEvent =
                | { stage: 'complete'; raw_note: string; segments: { speaker: string; start: number; end: number; text: string }[] | null; audio_file_id?: string }
                | { stage: 'error'; error?: string; message?: string; raw_note?: string; audio_file_id?: string };
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
                    if (evt.stage === 'transcribing' || evt.stage === 'diarizing') {
                        setStage(evt.stage);
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
                alert(
                    `Speaker identification is unavailable: ${finalEvent.message || 'pipeline not configured'}\n\n` +
                    `Continuing with a single-speaker transcript. Uncheck "Identify speakers" to skip this warning.`
                );
                if (finalEvent.raw_note) {
                    form.setValue('noteContentRaw', finalEvent.raw_note);
                    form.setValue('noteContentSegments', null);
                    if (finalEvent.audio_file_id) form.setValue('audioFileId', finalEvent.audio_file_id);
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
                alert('Transcription unable to identify speech. Please try again.');
                setStage(null);
                return;
            }

            form.setValue('noteContentRaw', finalEvent.raw_note);
            form.setValue('noteContentSegments', finalEvent.segments ?? null);
            if (finalEvent.audio_file_id) form.setValue('audioFileId', finalEvent.audio_file_id);

            // Hand off to the formatting stage. getMarkdown clears stage in
            // its finally block, so we don't clear it here.
            setStage('formatting');
            await getMarkdown(finalEvent.raw_note);
        } catch (error: any) {
            console.error('Upload failed:', error);
            alert(`Upload failed: ${error.message}`);
            setStage(null);
        }
    }

    const getMarkdownStructured = async (rawNote: string) => {
        // Streaming path for structured (Studio) templates. Backend may run
        // single-call (one Ollama round-trip, one `complete` event) or
        // per-field (one event per field, then `complete`) depending on the
        // template's effective strictness. Frontend treats both the same way:
        // consume events, render progress, take the final markdown.
        try {
            const res = await fetch('http://127.0.0.1:5000/api/notes/run-structured', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${auth.token}`,
                },
                body: JSON.stringify({
                    raw_note: rawNote,
                    template_id: form.getValues('noteTemplate'),
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
                if (res.status === 422 && errBody.error === 'model_not_installed') {
                    form.setValue('noteContentMarkdown', rawNote);
                    mdxEditorRef.current?.setMarkdown(rawNote);
                    setMarkdown(rawNote);
                    alert(errBody.message || `Model '${errBody.model}' isn't installed.`);
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
                alert(`Structured run failed: ${errorMessage}`);
                return;
            }
            if (finalMarkdown === null) {
                alert('Structured run ended without a final markdown payload.');
                return;
            }

            form.setValue('noteContentMarkdown', finalMarkdown);
            mdxEditorRef.current?.setMarkdown(finalMarkdown);
            setMarkdown(finalMarkdown);
            handleAddNewNote({ preventDefault: () => {} } as React.FormEvent, form);
        } catch (e: any) {
            console.error('Structured formatting failed:', e);
            alert(`Formatting failed: ${e.message}`);
        }
    };

    const getMarkdown = async (rawNote: string) => {
        // Caller sets stage='formatting' before invoking this so the spinner
        // label is correct from the moment the request goes out. We only
        // need to clear it in our finally.
        setStage('formatting');
        form.setValue('noteContentMarkdown', '');
        mdxEditorRef.current?.setMarkdown('');

        // Branch on the picked template's type. Structured templates run on
        // a different endpoint that streams per-field progress.
        if (selectedTemplateType === 'structured') {
            try {
                await getMarkdownStructured(rawNote);
            } finally {
                setStage(null);
                // Keep structuredProgress around so the user can see the final
                // per-field summary even after the run completes. They can
                // clear it via the form reset / new-note action.
            }
            return;
        }

        try {
            const response = await fetch('http://127.0.0.1:5000/api/getMarkdown', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${auth.token}`,
                },
                body: JSON.stringify({
                    raw_note: rawNote,
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
                    const fallback = errorData.raw_note || rawNote;
                    form.setValue('noteContentMarkdown', fallback);
                    mdxEditorRef.current?.setMarkdown(fallback);
                    setMarkdown(fallback);
                    alert(errorData.message || `The model '${errorData.model}' isn't installed. An admin needs to pull it before this template can be used.`);
                    return;
                }
                if (response.status === 503) {
                    // Ollama unavailable — fall back to the raw transcript so the
                    // user can edit/save manually instead of losing the recording.
                    const fallback = errorData.raw_note || rawNote;
                    form.setValue('noteContentMarkdown', fallback);
                    mdxEditorRef.current?.setMarkdown(fallback);
                    setMarkdown(fallback);
                    alert(errorData.error || 'AI formatting unavailable. Showing the raw transcript so you can edit and save manually.');
                    return; // don't auto-save; let the user review
                }
                throw new Error(errorData.error || `Server error: ${response.status}`);
            }

            const result = await response.json();
            form.setValue('noteContentMarkdown', result.formatted_markdown);
            mdxEditorRef.current?.setMarkdown(result.formatted_markdown);
            setMarkdown(result.formatted_markdown);

            //save note
            handleAddNewNote({ preventDefault: () => {} } as React.FormEvent, form);
        } catch (error: any) {
            console.error('Failed to get markdown:', error);
            alert(`Formatting failed: ${error.message}`);
        } finally {
            setStage(null);
        }
    }

  return (
    <Form {...form}>
    <form onSubmit={(e) => handleAddNewNote(e, form)}>
        <div className="flex flex-col gap-4">
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
                                    <SelectTrigger className='z-10 bg-white'>
                                        <SelectValue placeholder="Select a template">
                                            {selectedTemplateName || "Select a template"}
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
            {modelMissing && (
                <div className="border-2 border-black bg-yellow-100 p-3 text-sm">
                    <strong>Heads up:</strong> this template is set to use the
                    <code className="mx-1 px-1 bg-white border border-black">{selectedTemplateLlmModel}</code>
                    model, which isn't installed in Ollama. Recording will still work, but the
                    transcript won't be auto-formatted — an admin needs to pull the model from
                    the Admin → Models page before this template can format notes.
                </div>
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

        {/* Diarization toggle — defaults on. Sent to /api/transcribe so the
            backend knows whether to run pyannote and return per-speaker segments. */}
        <div className="flex items-center gap-2 mt-4">
            <input
                id="diarize-toggle"
                type="checkbox"
                checked={diarize}
                onChange={(e) => setDiarize(e.target.checked)}
                disabled={busy}
                className="h-4 w-4 cursor-pointer accent-[#fd3777]"
            />
            <label htmlFor="diarize-toggle" className="text-sm cursor-pointer select-none">
                Identify speakers (diarize)
            </label>
        </div>

        {/* Audio source: live recording vs. file upload. The transcribe pipeline
            is identical for both — they both feed into transcribeRecording(). */}
        <Tabs defaultValue="record" className="w-full mt-4">
            <TabsList className="flex w-full">
                <TabsTrigger className="grow" value="record">Record</TabsTrigger>
                <TabsTrigger className="grow" value="upload">Upload</TabsTrigger>
            </TabsList>

            {!templateSelected && (
                <div className="border-2 border-black bg-yellow-100 p-3 text-sm mt-4">
                    <strong>Pick a template above first.</strong> Recording and uploading are
                    disabled until a template is selected — otherwise the transcript can't be
                    auto-formatted.
                </div>
            )}

            <TabsContent value="record">
                <div className="flex justify-between items-center mt-4">
                    <Microphone
                        key={microphoneKey}
                        onRecordingFinished={transcribeRecording}
                        disabled={!templateSelected}
                    />
                </div>
            </TabsContent>

            <TabsContent value="upload">
                <div className="flex flex-col items-center w-full mt-4 gap-3">
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="audio/*,video/*,.m4a,.mp3,.wav,.webm,.mp4,.ogg,.flac,.aac"
                        onChange={handleFilePicked}
                        disabled={busy || !templateSelected}
                        className="hidden"
                    />
                    {!uploadedFile ? (
                        <NeoButton
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={busy || !templateSelected}
                        >
                            Choose audio file
                        </NeoButton>
                    ) : (
                        <div className="flex flex-col items-center w-full gap-2">
                            <div className="text-sm">
                                <span className="font-semibold">{uploadedFile.name}</span>
                                {' '}({(uploadedFile.size / (1024 * 1024)).toFixed(1)} MB)
                            </div>
                            {uploadedAudioUrl && (
                                <audio controls src={uploadedAudioUrl} className="w-full" />
                            )}
                            <div className="flex gap-2">
                                <NeoButton
                                    type="button"
                                    onClick={handleTranscribeUpload}
                                    disabled={busy || !templateSelected}
                                >
                                    Transcribe this file
                                </NeoButton>
                                <NeoButton
                                    type="button"
                                    onClick={clearUploadedFile}
                                    disabled={busy}
                                >
                                    Choose a different file
                                </NeoButton>
                            </div>
                        </div>
                    )}
                    <p className="text-xs text-gray-600 text-center max-w-md">
                        Supports common audio formats (mp3, m4a, wav, webm, ogg, flac) and video files
                        (audio track is extracted). Large files may take a while to transcribe.
                    </p>
                </div>
            </TabsContent>
        </Tabs>

        {/* Pipeline progress: spinner + current stage label + elapsed time.
            Stage transitions are driven by the NDJSON stream from /api/transcribe
            (transcribing → diarizing) and by the frontend before /api/getMarkdown
            (formatting). */}
        {stage && (
            <div className="flex flex-col w-full justify-center items-center mt-4 gap-1">
                <div className="flex items-center gap-2">
                    <span className="inline-block h-4 w-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                    <span>
                        {stage === 'transcribing' && 'Transcribing audio (Whisper)...'}
                        {stage === 'diarizing' && 'Identifying speakers (pyannote)...'}
                        {stage === 'formatting' && 'Formatting note (LLM)...'}
                    </span>
                </div>
                <span className="text-xs text-gray-600 tabular-nums">
                    {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')} elapsed
                </span>
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
                    <FormField
                        control={form.control}
                        name="noteContentRaw"
                        render={({ field }) => (
                            <FormItem className="flex flex-col mt-4">
                                <FormLabel>Raw Transcription</FormLabel>
                                <FormControl>
                                    <Textarea {...field} disabled />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
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
        {!savingNote && form.getValues("noteContentRaw") && form.getValues("noteContentMarkdown") && (
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
                    clearUploadedFile();
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