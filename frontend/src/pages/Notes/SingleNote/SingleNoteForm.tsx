import { API_BASE } from "@/lib/api";
import { flagOllamaDown } from "@/lib/ollama";
import React, { FormEvent, ReactEventHandler, useEffect } from 'react'
import { useForm, useFormState } from 'react-hook-form'
import { format } from 'date-fns'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { ArchiveRestore, CalendarIcon, ChevronRight, RefreshCcw, Trash, Trash2 } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import MarkdownEditor from '@/components/md-editor'
import { BoldItalicUnderlineToggles, headingsPlugin, listsPlugin, ListsToggle, MDXEditorMethods, quotePlugin, toolbarPlugin, UndoRedo } from '@mdxeditor/editor'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '../../../context/auth-context'
import PirateWheel from '@/components/PirateWheel'
import NeoButton from '@/components/neo/neo-button'
import { useNavigate } from 'react-router'
import ParticipantSelector, { Participant, NewParticipant } from '@/components/participant-selector'
import NoteAudioPlayer, { type NoteAudioPlayerHandle } from '@/components/recording/note-audio-player'
import DiarizedTranscript, { type SpeakerLabels } from '@/components/recording/diarized-transcript'
import { type WordInfo, countLowConfidence } from '@/components/transcription/ConfidenceText'
import EditableConfidenceText from '@/components/transcription/EditableConfidenceText'

type Props = {
    note: any;
    templates: any[];
    savedParticipants: any[];
    siblings?: any[];
}

const SingleNoteForm = ({ note, templates, savedParticipants, siblings = [] }: Props) => {
    const auth = useAuth();
    const mdxEditorRef = React.useRef<MDXEditorMethods>(null);
    const audioPlayerRef = React.useRef<NoteAudioPlayerHandle>(null);
    const [savingNote, setSavingNote] = React.useState(false);
    const [selectedTemplateName, setSelectedTemplateName] = React.useState('');
    const [showRetranscribe, setShowRetranscribe] = React.useState(false);
    const [retranscribeTemplateId, setRetranscribeTemplateId] = React.useState('');
    const [retranscribing, setRetranscribing] = React.useState(false);
    const [siblingsExpanded, setSiblingsExpanded] = React.useState(false);
    // Approval state. Mirrored locally so the UI re-renders without a full
    // page reload after the user clicks Approve. The note prop reflects the
    // initial server state; this overrides it once the user acts.
    const [approvedAt, setApprovedAt] = React.useState<string | null>(
        note?.approvedAt ?? null,
    );
    // Workflow status, mirrored locally so the UI updates without a reload
    // after a transition. draft -> finalized -> signed; signing is permanent.
    type NoteStatus = 'draft' | 'finalized' | 'signed';
    const [status, setStatus] = React.useState<NoteStatus>(
        (note?.status as NoteStatus) ?? 'draft',
    );
    const [signedAt, setSignedAt] = React.useState<string | null>(note?.signedAt ?? null);
    const signed = status === 'signed';
    // Addenda — the only way to add content once signed. Append-only.
    type Addendum = { id: string; authorName: string; content: string; createdAt: string };
    const [addenda, setAddenda] = React.useState<Addendum[]>(note?.addenda ?? []);
    const [addendumDraft, setAddendumDraft] = React.useState('');
    const [addingAddendum, setAddingAddendum] = React.useState(false);
    // Per-word Whisper probabilities from the persisted note. May be null on
    // legacy rows or notes whose audio source didn't go through Whisper.
    const whisperWords: WordInfo[] = note?.noteContentWords ?? [];
    // Speaker -> identity assignments for the diarized transcript. Mirrored
    // locally so labels update without a reload after each assignment. Editing
    // is allowed only until the note is approved (the raw transcript lock).
    const [speakerLabels, setSpeakerLabels] = React.useState<SpeakerLabels>(
        note?.speakerLabels ?? {},
    );
    const navigation = useNavigate();

    const assignSpeaker = async (
        rawSpeaker: string,
        value: { participantId: string | null; name: string } | null,
    ) => {
        const prev = speakerLabels;
        const next = { ...prev };
        if (value) next[rawSpeaker] = value;
        else delete next[rawSpeaker];
        setSpeakerLabels(next); // optimistic
        try {
            const res = await fetch(`${API_BASE}/api/notes/${note.id}/speakers`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${auth.token}`,
                },
                body: JSON.stringify({ speakerLabels: next }),
            });
            if (!res.ok) throw new Error(`speakers PUT failed: ${res.status}`);
            // Re-sync from the server's cleaned map — it drops stale or
            // unresolvable entries, so this is the source of truth.
            const data = await res.json();
            setSpeakerLabels(data.speakerLabels ?? {});
        } catch (e) {
            console.log('Failed to save speaker labels:', e);
            setSpeakerLabels(prev); // roll back the optimistic update
        }
    };

    const form = useForm({
        defaultValues: {
            authorId: note?.authorId,
            authorName: note?.authorName,
            // Empty string for null DB values so the input stays controlled;
            // server trims + nulls on PUT.
            name: note?.name ?? '',
            noteDate: note?.noteDate,
            noteContentRaw: note?.noteContentRaw,
            noteContentMarkdown: note?.noteContentMarkdown,
            noteType: note?.noteType,
            version: note?.version,
            createdAt: note?.createdAt,
            updatedAt: note?.updatedAt,
            participants: note?.participants || '',
            noteTemplate: note?.noteTemplate ?? '',
        }
    });

    const formState = useFormState({
        control: form.control,})

    // Templates may load after the form mounts; reconcile noteTemplate once the
    // saved template is actually present in the dropdown options.
    useEffect(() => {
        if (!note?.noteTemplate || templates.length === 0) return;
        const match = templates.find((t) => t.id === note.noteTemplate);
        if (match && form.getValues('noteTemplate') !== match.id) {
            form.setValue('noteTemplate', match.id, { shouldDirty: false });
        }
    }, [templates, note?.noteTemplate]);

    const handleApprove = async () => {
        if (!window.confirm(
            'Lock the raw transcript? After approval, the raw text is read-only and the confidence highlights are hidden. This cannot be undone.'
        )) return;
        setSavingNote(true);
        try {
            // Save any pending edits first so the locked version reflects
            // what the user is looking at right now.
            if (formState.isDirty) {
                const saveRes = await fetch(`${API_BASE}/api/notes/${note.id}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${auth.token}`,
                    },
                    body: JSON.stringify(form.getValues()),
                });
                if (!saveRes.ok) {
                    const err = await saveRes.json().catch(() => ({}));
                    throw new Error(err.error || `Save failed (${saveRes.status})`);
                }
                // Reset the form so isDirty clears.
                const updated = await saveRes.json();
                form.reset({
                    authorId: updated?.authorId,
                    authorName: updated?.authorName,
                    name: updated?.name ?? '',
                    noteDate: updated?.noteDate,
                    noteContentRaw: updated?.noteContentRaw,
                    noteContentMarkdown: updated?.noteContentMarkdown,
                    noteType: updated?.noteType,
                    version: updated?.version,
                    createdAt: updated?.createdAt,
                    updatedAt: updated?.updatedAt,
                    participants: updated?.participants,
                    noteTemplate: templates.find((t: any) => t.id === updated.noteTemplate)?.id,
                });
            }
            const res = await fetch(`${API_BASE}/api/notes/${note.id}/approve`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${auth.token}` },
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `Approve failed (${res.status})`);
            }
            const data = await res.json();
            setApprovedAt(data.approvedAt);
        } catch (e: any) {
            alert(e.message ?? 'Could not approve note.');
        }
        setSavingNote(false);
    };

    const handleUpdateNote = async (e: FormEvent, form: any) => {
        e.preventDefault();
        setSavingNote(true);
        const formValues = form.getValues();
        console.log('submitting note', formValues);

        try {
            const response = await fetch(`${API_BASE}/api/notes/${note.id}`, {
                method: 'PUT',
                headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${auth.token}`,
                },
                body: JSON.stringify(formValues)
            });

            const data = await response.json();

            if (!response.ok) {
                console.log('Error updating note: ', data);
                throw new Error('Network request failed with status ' + response.status);
            } else {
                console.log('Note updated:', data);
            
                // Reset form with the updated data from server
                console.log('Form data before reset: ', form.getValues());
                const updatedNote = {
                    authorId: data?.authorId,
                    authorName: data?.authorName,
                    name: data?.name ?? '',
                    noteDate: data?.noteDate,
                    noteContentRaw: data?.noteContentRaw,
                    noteContentMarkdown: data?.noteContentMarkdown,
                    noteType: data?.noteType,
                    version: data?.version,
                    createdAt: data?.createdAt,
                    updatedAt: data?.updatedAt,
                    participants: data?.participants,
                    noteTemplate: templates.find((template) => template.id === data.noteTemplate)?.id,
                };
                
                form.reset(updatedNote);
                console.log('form state dirty: ', formState.isDirty);
                console.log('form data after reset: ', form.getValues());
            }
        } catch (error) {
            alert('Error submitting note. Please try again.');
            console.log('Error submitting note: ', error)
        }
        setSavingNote(false);
    }
    
    // Transition the note's workflow status. Forward moves (finalize, sign)
    // save any pending edits first so the new state reflects what's on
    // screen — mirrors handleApprove. Signing is permanent, hence the
    // confirm. The backend enforces which transitions are legal.
    const handleStatusChange = async (target: NoteStatus) => {
        if (target === 'signed' && !window.confirm(
            'Sign this note? Signing is permanent: the note becomes read-only ' +
            'and any further changes can only be added as addenda. This also ' +
            'locks the raw transcript.'
        )) return;

        setSavingNote(true);
        try {
            if (formState.isDirty && target !== 'draft') {
                const saveRes = await fetch(`${API_BASE}/api/notes/${note.id}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${auth.token}`,
                    },
                    body: JSON.stringify(form.getValues()),
                });
                if (!saveRes.ok) {
                    const err = await saveRes.json().catch(() => ({}));
                    throw new Error(err.error || `Save failed (${saveRes.status})`);
                }
                const updated = await saveRes.json();
                form.reset({
                    authorId: updated?.authorId,
                    authorName: updated?.authorName,
                    name: updated?.name ?? '',
                    noteDate: updated?.noteDate,
                    noteContentRaw: updated?.noteContentRaw,
                    noteContentMarkdown: updated?.noteContentMarkdown,
                    noteType: updated?.noteType,
                    version: updated?.version,
                    createdAt: updated?.createdAt,
                    updatedAt: updated?.updatedAt,
                    participants: updated?.participants,
                    noteTemplate: templates.find((t: any) => t.id === updated.noteTemplate)?.id,
                });
            }
            const res = await fetch(`${API_BASE}/api/notes/${note.id}/status`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${auth.token}`,
                },
                body: JSON.stringify({ status: target }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `Status change failed (${res.status})`);
            }
            const data = await res.json();
            setStatus(data.status);
            setSignedAt(data.signedAt ?? null);
            if (data.approvedAt) setApprovedAt(data.approvedAt);
        } catch (e: any) {
            alert(e.message ?? 'Could not change note status.');
        }
        setSavingNote(false);
    };

    const handleAddAddendum = async () => {
        const content = addendumDraft.trim();
        if (!content) return;
        setAddingAddendum(true);
        try {
            const res = await fetch(`${API_BASE}/api/notes/${note.id}/addenda`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${auth.token}`,
                },
                body: JSON.stringify({ content }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `Failed to add addendum (${res.status})`);
            }
            const created = await res.json();
            setAddenda((prev) => [...prev, created]);
            setAddendumDraft('');
        } catch (e: any) {
            alert(e.message ?? 'Could not add addendum.');
        }
        setAddingAddendum(false);
    };

    const handleDeleteNote = async () => {
        if (confirm('Are you sure you want to delete this note?')) {
            try {
                const response = await fetch(`${API_BASE}/api/notes/${note.id}/delete`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${auth.token}`,
                    },
                    body: JSON.stringify({id: note.id})
                });
                if (!response.ok) {
                    throw new Error('Network request failed with status ' + response.status);
                } else {
                    //note deleted
                    //redirect to notes page
                    alert('Note deleted successfully');
                    navigation('/notes');
                }
            } catch (error) {
                alert('Error deleting note. Please try again.');
                console.log('Error deleting note: ', error)
            }
        }
    }

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
        
        if (!response.ok) throw new Error('Failed to create participant');

        // Add the new participant to the current participants state
        const createdParticipant: Participant = {
            id: data.id,
            firstName: data.first_name,
            lastName: data.last_name,
            email: data.email,
        }
        
        // setCurrentParticipants(prev => [...prev, createdParticipant]);
        form.setValue('participants', [...form.getValues('participants'), createdParticipant]);

        return createdParticipant;
    };

    const handleDeleteParticipant = async (participantId: string) => {
        return;

        //TODO do I want to be able to do this? and if so, how do you handle when a participant is deleted
        // and a note is saved with that participant

        if (confirm('Are you sure you want to delete this participant?')) {
            try {
                const response = await fetch(`${API_BASE}/api/participants/${participantId}`, {
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${auth.token}`,
                    },
                });

                const data = await response.json();

                if (!response.ok) {
                    console.log('Error deleting participant: ', data);
                    throw new Error('Network request failed with status ' + response.status);
                } else {
                    // Remove the participant from the current participants state
                    const updatedParticipants = form.getValues('participants').filter((p: Participant) => p.id !== participantId);
                    form.setValue('participants', updatedParticipants);
                    alert('Participant deleted successfully');
                }
            } catch (error) {
                alert('Error deleting participant. Please try again.');
                console.log('Error deleting participant: ', error);
            }
        }
    }

    const handleRestoreNote = async () => {
        if (confirm('Are you sure you want to restore this note?')) {
            try {
                const response = await fetch(`${API_BASE}/api/notes/${note.id}/restore`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${auth.token}`,
                    },
                    body: JSON.stringify({id: note.id})
                });
                if (!response.ok) {
                    throw new Error('Network request failed with status ' + response.status);
                } else {
                    //note restored
                    //redirect to notes page
                    alert('Note restored successfully');
                    navigation('/notes');
                }
            } catch (error) {
                alert('Error restoring note. Please try again.');
                console.log('Error restoring note: ', error)
            }
        }
    }

    // Re-transcribe the existing raw transcript through a different template.
    // A note is locked to its original template, so this creates a new note.
    const handleRetranscribe = async () => {
        if (!retranscribeTemplateId || !note?.noteContentRaw) return;
        setRetranscribing(true);
        try {
            const fmtResponse = await fetch(`${API_BASE}/api/getMarkdown`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${auth.token}`,
                },
                body: JSON.stringify({
                    raw_note: note.noteContentRaw,
                    // Backend rewrites "Speaker N" to the assigned names before
                    // the LLM sees the transcript.
                    speaker_labels: speakerLabels,
                    note_details: {
                        note_date: note.noteDate,
                        template_id: retranscribeTemplateId,
                        participants: note.participants,
                    }
                }),
            });

            if (!fmtResponse.ok) {
                const err = await fmtResponse.json().catch(() => ({}));
                if (fmtResponse.status === 503) flagOllamaDown();
                throw new Error(err.error || `Format failed: ${fmtResponse.status}`);
            }

            // NDJSON stream: drain to completion. Re-transcribe doesn't have
            // a live editor to push deltas into (the user clicked a button
            // and is staring at a spinner), so we just accumulate.
            if (!fmtResponse.body) throw new Error('Markdown stream had no body');
            const reader = fmtResponse.body.getReader();
            const decoder = new TextDecoder();
            let buf = '';
            let accumulated = '';
            let finalMarkdown: string | null = null;
            let streamError: string | null = null;
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buf += decoder.decode(value, { stream: true });
                const lines = buf.split('\n');
                buf = lines.pop() ?? '';
                for (const line of lines) {
                    if (!line.trim()) continue;
                    let evt: any;
                    try { evt = JSON.parse(line); } catch { continue; }
                    if (evt.stage === 'chunk' && typeof evt.delta === 'string') {
                        accumulated += evt.delta;
                    } else if (evt.stage === 'complete' && typeof evt.markdown === 'string') {
                        finalMarkdown = evt.markdown;
                    } else if (evt.stage === 'error') {
                        streamError = evt.message || 'AI formatting failed mid-stream.';
                    }
                }
            }
            if (buf.trim()) {
                try {
                    const evt = JSON.parse(buf);
                    if (evt.stage === 'complete' && typeof evt.markdown === 'string') {
                        finalMarkdown = evt.markdown;
                    } else if (evt.stage === 'error') {
                        streamError = evt.message || 'AI formatting failed mid-stream.';
                    }
                } catch { /* ignore */ }
            }
            if (streamError) { flagOllamaDown(); throw new Error(streamError); }
            const formattedMarkdown = finalMarkdown ?? accumulated;

            const saveResponse = await fetch(`${API_BASE}/api/notes`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${auth.token}`,
                },
                body: JSON.stringify({
                    authorId: auth.user?.id,
                    authorName: note.authorName,
                    // Inherit the parent's name on re-transcribe — same
                    // conversation, just re-formatted with a new template.
                    // Editable on the new note's page.
                    name: note.name ?? '',
                    noteDate: note.noteDate,
                    noteContentRaw: note.noteContentRaw,
                    noteContentMarkdown: formattedMarkdown,
                    noteType: note.noteType,
                    noteTemplate: retranscribeTemplateId,
                    participants: note.participants,
                    version: 1,
                    sourceNoteId: note.id,
                }),
            });

            if (!saveResponse.ok) {
                const err = await saveResponse.json().catch(() => ({}));
                throw new Error(err.error || `Save failed: ${saveResponse.status}`);
            }

            const newNote = await saveResponse.json();
            navigation(`/notes/${newNote.id}`);
        } catch (e: any) {
            alert(`Re-transcribe failed: ${e.message}`);
        } finally {
            setRetranscribing(false);
        }
    };

    const handleDeleteNotePermanently = async (noteId: string) => {
        if (confirm('Are you sure you want to delete this note permanently? This action cannot be undone.')) {
            try {
                const response = await fetch(`${API_BASE}/api/notes/${noteId}/delete-permanently`, {
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${auth.token}`,
                    },
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok) {
                    // 409 = note not in trash yet, or still inside the org's
                    // retention window. The server message explains which.
                    alert(data.error || `Could not delete note (status ${response.status}).`);
                    return;
                }
                alert(data.message || 'Note permanently deleted.');
                navigation('/notes');
            } catch (error) {
                alert('Error deleting note permanently. Please try again.');
                console.log('Error deleting note permanently: ', error)
            }
        }
    }

    // Templates already used in this transcript group (current note + siblings).
    // Re-transcribe should only offer templates not yet used.
    const usedTemplateIds = new Set<string>(
        [note?.noteTemplate, ...siblings.map((s: any) => s.noteTemplate)].filter(Boolean)
    );
    const availableRetranscribeTemplates = templates.filter(
        (t: any) => !t.isDeleted && !usedTemplateIds.has(t.id)
    );

  return (
    <Form {...form}>
    <form onSubmit={(e) => handleUpdateNote(e, form)}>
        <div className="flex flex-col gap-4">
            {/* Workflow status banner. draft -> finalized -> signed. */}
            <div className="flex items-center gap-2 text-sm">
                <span className="font-bold uppercase tracking-wider text-xs">Status:</span>
                <span
                    className={
                        "border-2 border-black px-2 py-0.5 text-xs font-extrabold uppercase tracking-wider " +
                        (status === 'signed'
                            ? "bg-green-200"
                            : status === 'finalized'
                            ? "bg-blue-200"
                            : "bg-white")
                    }
                >
                    {status}
                </span>
                {signed && signedAt && (
                    <span className="text-xs text-muted-foreground">
                        Signed {new Date(signedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                )}
                {signed && (
                    <span className="text-xs text-muted-foreground italic">
                        — locked; content can only be extended with addenda below.
                    </span>
                )}
            </div>
            {/* Editable title for the notes table. Blank round-trips to
                null on the server; the table view falls back to
                "<template> – <datetime>" when null. */}
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
                                disabled={note?.isDeleted}
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
                    render={({ field }) => {
                        const currentTemplate = templates.find(t => t.id === field.value);

                        return (
                        <FormItem>
                            <FormLabel>Note Template</FormLabel>
                            <FormControl>
                                <Select
                                    onValueChange={(value) => {
                                        field.onChange(value);
                                    }}
                                    value={field.value}
                                    disabled
                                >
                                    <SelectTrigger className='z-10 bg-white [&>span]:line-clamp-none [&>span]:overflow-visible'>
                                        <SelectValue placeholder="Select a template">
                                            {currentTemplate ? (
                                                <>
                                                    <span
                                                        className={
                                                            'mr-2 inline-block align-middle border-2 px-1.5 py-px text-[9px] font-extrabold uppercase tracking-wider ' +
                                                            (currentTemplate.templateType === 'structured'
                                                                ? 'border-[#5d1d91] bg-[#5d1d91] text-white'
                                                                : 'border-black bg-white text-black')
                                                        }
                                                        title={
                                                            currentTemplate.templateType === 'structured'
                                                                ? 'Built in PrivateScribe Studio (structured fields)'
                                                                : 'Markdown template'
                                                        }
                                                    >
                                                        {currentTemplate.templateType === 'structured' ? 'Studio' : 'Simple'}
                                                    </span>
                                                    <span className='align-middle'>{currentTemplate.name}</span>
                                                </>
                                            ) : (
                                                'Select a template'
                                            )}
                                        </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent className='z-10 bg-white'>
                                        {templates.map((template: any) => (
                                            <SelectItem
                                                key={template.id}
                                                value={template.id}
                                                className='hover:bg-[#fd3777]'
                                                >
                                                {template.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </FormControl>
                            <p className="text-xs text-muted-foreground italic mt-1">
                                Templates are locked to a note. Re-record with a different template to create a new note.
                            </p>
                            <FormMessage />
                        </FormItem>
                    )}}
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
            <fieldset className="flex flex-col gap-2">
                <FormField
                    control={form.control}
                    name="participants"
                    render={({ field }) => (
                        <FormItem className="flex flex-col">
                        <FormControl>
                            <ParticipantSelector
                                selectedParticipants={field.value}
                                onChange={(field.onChange)}
                                onCreateParticipant={handleCreateParticipant}
                                onDeleteParticipant={handleDeleteParticipant}
                                disabled={signed || note?.isDeleted}
                                savedParticipants={savedParticipants}
                            />
                        </FormControl>
                        <FormMessage />
                        </FormItem>
                    )}
                    />
            </fieldset>
        </div>

        {/* Source audio playback. Rendered above the tabs so the user can
            scrub the recording while reading either the markdown or the raw
            transcript. Only present for notes that came from a recording —
            text-only notes have hasAudio=false. */}
        {note?.hasAudio && (
            <div className="mt-4">
                <NoteAudioPlayer
                    ref={audioPlayerRef}
                    noteId={note.id}
                    filename={note.audioOriginalFilename}
                    sizeBytes={note.audioSizeBytes}
                />
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
                <FormField
                    control={form.control}
                    name="noteContentMarkdown"
                    render={({ field }) => (
                        <FormItem className="w-full mt-4">
                            <FormControl>
                                {/* <Textarea {...field} />  */}
                                <MarkdownEditor
                                    className="w-full"
                                    readOnly={signed}
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
                                    markdown={field.value}
                                    onChange={(value) => {
                                        field.onChange(value);
                                    }}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            </TabsContent>

            <TabsContent value="transcript">
                {note?.noteContentSegments ? (
                    <div className="flex flex-col mt-4 gap-1">
                        <FormLabel>Raw Transcription</FormLabel>
                        <DiarizedTranscript
                            segments={note.noteContentSegments}
                            speakerLabels={speakerLabels}
                            participants={Array.isArray(note?.participants) ? note.participants : []}
                            editable={approvedAt === null}
                            onAssign={assignSpeaker}
                            onSeek={note?.hasAudio ? (s) => audioPlayerRef.current?.seek(s) : undefined}
                        />
                    </div>
                ) : (
                    <FormField
                        control={form.control}
                        name="noteContentRaw"
                        render={({ field }) => {
                            const locked = approvedAt !== null;
                            const lowCount = whisperWords.length
                                ? countLowConfidence(whisperWords)
                                : 0;
                            return (
                                <FormItem className="flex flex-col mt-4">
                                    <div className="flex items-baseline justify-between">
                                        <FormLabel>Raw Transcription</FormLabel>
                                        {!locked && lowCount > 0 && (
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
                                                {lowCount} word{lowCount === 1 ? '' : 's'} flagged for review
                                            </span>
                                        )}
                                    </div>
                                    <FormControl>
                                        {locked || whisperWords.length === 0 ? (
                                            // No word data (legacy / non-Whisper) or
                                            // locked: plain disabled textarea.
                                            <Textarea {...field} disabled={locked} />
                                        ) : (
                                            // Draft + word data present: contenteditable
                                            // div with inline highlight spans. The user
                                            // edits directly; highlights stay until they
                                            // touch a flagged word.
                                            <EditableConfidenceText
                                                value={field.value || ''}
                                                words={whisperWords}
                                                onChange={(next) => field.onChange(next)}
                                            />
                                        )}
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            );
                        }}
                    />
                )}
            </TabsContent>
        </Tabs>
        )}

        {/* Addenda — append-only entries on a signed note. The list shows
            whenever any exist; the add form appears only once signed. */}
        {(addenda.length > 0 || signed) && (
            <div className="mt-6 border-2 border-black bg-white p-4">
                <h3 className="text-sm font-black uppercase tracking-wider mb-3">Addenda</h3>
                {addenda.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">
                        No addenda yet. Use the box below to append one.
                    </p>
                ) : (
                    <div className="space-y-3">
                        {addenda.map((a) => (
                            <div key={a.id} className="border-l-4 border-black pl-3">
                                <div className="text-xs text-muted-foreground mb-1">
                                    {a.authorName} · {new Date(a.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                                </div>
                                <div className="text-sm whitespace-pre-wrap break-words">{a.content}</div>
                            </div>
                        ))}
                    </div>
                )}
                {signed && !note?.isDeleted && (
                    <div className="mt-4 flex flex-col gap-2">
                        <Textarea
                            value={addendumDraft}
                            onChange={(e) => setAddendumDraft(e.target.value)}
                            placeholder="Add an addendum…"
                            disabled={addingAddendum}
                        />
                        <div>
                            <NeoButton
                                type="button"
                                onClick={handleAddAddendum}
                                disabled={addingAddendum || !addendumDraft.trim()}
                                backgroundColor="#fd3777"
                                textColor="#ffffff"
                            >
                                {addingAddendum ? 'Adding…' : 'Add Addendum'}
                            </NeoButton>
                        </div>
                    </div>
                )}
            </div>
        )}

        {/* Buttons */}
        {savingNote && (
            <div className="flex flex-col w-full justify-center items-center mt-4">
                <p className="text-primary">Saving note...</p>
            </div>
        )}
        {!savingNote && form.getValues("noteContentRaw") && form.getValues("noteContentMarkdown") && (
        <div className='flex justify-between items-center gap-4 mt-4'>
            <div className='flex gap-3 items-center'>
                <NeoButton
                    type="submit"
                    backgroundColor='#fd3777'
                    textColor='#ffffff'
                    disabled={!formState.isDirty || savingNote}
                >
                    Save Note
                </NeoButton>
                {/* Approve locks the raw transcript forever. Only shown while
                    the note is still in draft (approvedAt is null) and the
                    note isn't in the trash. */}
                {approvedAt === null && !note?.isDeleted && (
                    <NeoButton
                        type="button"
                        onClick={handleApprove}
                        disabled={savingNote}
                    >
                        Approve
                    </NeoButton>
                )}
                {approvedAt !== null && (
                    <span className="text-xs text-muted-foreground">
                        Approved {new Date(approvedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                )}
                {/* Workflow transitions. draft<->finalized is reversible;
                    Sign is permanent. Hidden once signed (banner shows it)
                    and while the note is trashed. */}
                {!note?.isDeleted && status === 'draft' && (
                    <NeoButton
                        type="button"
                        onClick={() => handleStatusChange('finalized')}
                        disabled={savingNote}
                    >
                        Finalize
                    </NeoButton>
                )}
                {!note?.isDeleted && status === 'finalized' && (
                    <>
                        <NeoButton
                            type="button"
                            onClick={() => handleStatusChange('draft')}
                            disabled={savingNote}
                        >
                            Reopen as Draft
                        </NeoButton>
                        <NeoButton
                            type="button"
                            backgroundColor="#16a34a"
                            textColor="#ffffff"
                            onClick={() => handleStatusChange('signed')}
                            disabled={savingNote}
                        >
                            Sign
                        </NeoButton>
                    </>
                )}
            </div>
            <div className='flex gap-4 items-center'>
                <NeoButton 
                    type="button"
                    disabled={!formState.isDirty}
                    onClick={() => {
                        form.reset();
                        mdxEditorRef.current?.setMarkdown(note?.noteContentMarkdown);
                    }}
                >
                    Reset
                </NeoButton>
                {note?.isDeleted && (
                <div className='flex gap-3 items-center'>
                    <NeoButton
                    backgroundColor='#fd3777'
                    type="button"
                    onClick={() => handleDeleteNotePermanently(note.id)}
                    ><Trash /></NeoButton>
                    <NeoButton 
                    type="button"
                    onClick={handleRestoreNote}
                >
                    <span className='flex gap-2 items-center justify-center'>Restore <RefreshCcw /></span>
                </NeoButton>
                </div>
                )}
                {!note?.isDeleted && (
                <NeoButton
                    type="button"
                    onClick={handleDeleteNote}
                >
                    <Trash2 />
                </NeoButton>
                )}
            </div>
        </div>
        )}

        {/* Other formats of this transcript (collapsible tree) */}
        {siblings.length > 0 && (
            <div className='mt-8 pt-4 border-t'>
                <button
                    type='button'
                    onClick={() => setSiblingsExpanded(!siblingsExpanded)}
                    className='flex items-center gap-2 text-lg font-bold hover:opacity-70 transition-opacity'
                    aria-expanded={siblingsExpanded}
                >
                    <ChevronRight
                        size={18}
                        className={`transition-transform duration-200 ${siblingsExpanded ? 'rotate-90' : ''}`}
                    />
                    Other formats of this transcript ({siblings.length})
                </button>
                {siblingsExpanded && (
                    <ul className='mt-3 ml-2 pl-4 border-l-2 border-gray-300 flex flex-col gap-2'>
                        {siblings.map((s) => {
                            const t = templates.find((t: any) => t.id === s.noteTemplate);
                            return (
                                <li key={s.id} className='flex items-center justify-between'>
                                    <div className='flex items-center gap-2'>
                                        <span className='text-gray-400 select-none'>└</span>
                                        <span className='font-semibold'>{t?.name || 'Unknown template'}</span>
                                        <span className='text-xs text-muted-foreground'>
                                            {s.createdAt ? new Date(s.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ''}
                                        </span>
                                    </div>
                                    <a href={`/notes/${s.id}`} className='text-sm underline'>View</a>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        )}

        {/* Re-transcribe with a different template (creates a new note) */}
        {!savingNote && note?.noteContentRaw && !note?.isDeleted &&
         availableRetranscribeTemplates.length > 0 && (
            <div className='mt-8 pt-4 border-t'>
                {!showRetranscribe ? (
                    <NeoButton
                        type="button"
                        onClick={() => setShowRetranscribe(true)}
                    >
                        Re-transcribe with different template
                    </NeoButton>
                ) : (
                    <div className='flex flex-col gap-3'>
                        <p className='text-sm text-muted-foreground'>
                            Format the raw transcript through a different template. This creates a new note — the current one is unchanged.
                        </p>
                        <Select
                            onValueChange={setRetranscribeTemplateId}
                            value={retranscribeTemplateId}
                            disabled={retranscribing}
                        >
                            <SelectTrigger className='z-10 bg-white'>
                                <SelectValue placeholder='Select a template' />
                            </SelectTrigger>
                            <SelectContent className='z-10 bg-white'>
                                {availableRetranscribeTemplates.map((t: any) => (
                                    <SelectItem
                                        key={t.id}
                                        value={t.id}
                                        className='hover:bg-[#fd3777]'
                                    >
                                        {t.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <div className='flex gap-3'>
                            <NeoButton
                                type='button'
                                onClick={handleRetranscribe}
                                disabled={!retranscribeTemplateId || retranscribing}
                                backgroundColor='#fd3777'
                                textColor='#ffffff'
                            >
                                {retranscribing ? 'Re-transcribing…' : 'Format & Save as New Note'}
                            </NeoButton>
                            <NeoButton
                                type='button'
                                onClick={() => {
                                    setShowRetranscribe(false);
                                    setRetranscribeTemplateId('');
                                }}
                                disabled={retranscribing}
                            >
                                Cancel
                            </NeoButton>
                        </div>
                    </div>
                )}
            </div>
        )}
    </form>
</Form>

  )
}

export default SingleNoteForm