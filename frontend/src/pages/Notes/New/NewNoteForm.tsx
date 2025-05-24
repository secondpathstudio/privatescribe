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
    templates: any[]
}

const NewNoteForm = ({templates}: Props) => {
    const auth = useAuth();
    const mdxEditorRef = React.useRef<MDXEditorMethods>(null)
    const [gettingMarkdown, setGettingMarkdown] = React.useState(false);
    const [markdown, setMarkdown] = React.useState('');
    const [isTranscribing, setIsTranscribing] = React.useState(false);
    const [microphoneKey, setMicrophoneKey] = React.useState(0);
    const [savingNote, setSavingNote] = React.useState(false);
    const [selectedTemplateName, setSelectedTemplateName] = React.useState('');
    const [currentParticipants, setCurrentParticipants] = React.useState<Participant[]>([]);
    const navigate = useNavigate();

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

            if (!response.ok) {
                console.error('Server response was not ok', response);
                throw new Error('Network request failed with status ' + response.status);
            } else {
                //note created
                //redirect to new note
                const data = await response.json();
                console.log('Note created:', data);
                navigate(`/notes/${data.id}`);
            }
        } catch (error) {
            alert('Error submitting note. Please try again.');
            console.log('Error submitting note: ', error)
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
            noteTemplate: '',
            noteType: '',
            version: 1,
            status: 'draft',
        }
    });

    //update local state for template name when selected template id changes
    useEffect(() => {
        const currentTemplateId = form.watch('noteTemplate');
            if (currentTemplateId && templates) {
            const selectedTemplate = templates.find(template => template.id === currentTemplateId);
            if (selectedTemplate) {
                setSelectedTemplateName(selectedTemplate.name);
            }
        }
    }, [form.watch('noteTemplate'), templates]);

    const handleCreateParticipant = async (newParticipant: NewParticipant): Promise<Participant> => {
        const response = await fetch('/api/participants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newParticipant),
        });
        
        if (!response.ok) throw new Error('Failed to create participant');
        return response.json();
    };

  //TODO validate that template is chosen before recording
    const transcribeRecording = async (blob: Blob) => {
        // get transcription from whisper
        setIsTranscribing(true);
        const formData = new FormData();
        formData.append('file', blob, 'recording.webm'); // Use WebM if you're recording with MediaRecorder

        console.log('Uploading audio for transcription...', blob);
        try {
            const response = await fetch('http://127.0.0.1:5000/api/transcribe', {
            method: 'POST',
            headers: {
                "Authorization": `Bearer ${auth.token}`,
            },
            body: formData,
            });

            if (!response.ok) {
                throw new Error(`Server error: ${response.status}`);
            }

            const result = await response.json();
            console.log('Transcription Result:', result);

            //handle if transcription is empty
            if (result.raw_note === '') {
                alert('Transcription unable to identify speech. Please try again.');
                setIsTranscribing(false);
                return;
            }

            form.setValue('noteContentRaw', result.raw_note);

            // Format the transcription in Markdown
            getMarkdown(result.raw_note);
        } catch (error: any) {
            console.error('Upload failed:', error);
            alert(`Upload failed: ${error.message}`);
        }
        setIsTranscribing(false);
    }

    const getMarkdown = async (rawNote: string) => {
        // get markdown from ollama
        setGettingMarkdown(true);
        form.setValue('noteContentMarkdown', '');
        mdxEditorRef.current?.setMarkdown('');

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
                throw new Error(`Server error: ${response.status}`);
            }

            const result = await response.json();
            form.setValue('noteContentMarkdown', result.formatted_markdown);
            mdxEditorRef.current?.setMarkdown(result.formatted_markdown);
            setMarkdown(result.formatted_markdown);
            console.log('Markdown Result:', result);
        } catch (error: any) {
            console.error('Failed to get markdown:', error);
        } 
        setGettingMarkdown(false);
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
                                disabled={false}
                            />
                        </FormControl>
                        <FormMessage />
                        </FormItem>
                    )}
                    />
            </fieldset>
        </div>

        {/* Microphone Component */}
        <div className="flex justify-between items-center mt-4">
            <Microphone 
                key={microphoneKey}
                onRecordingFinished={transcribeRecording}
            />
        </div>

        {/* animation for server processing */}
        {isTranscribing && (
        <div className="flex flex-col w-full justify-center items-center mt-4">
            Transcribing note...
        </div>
        )}

        {gettingMarkdown && (
        <div className="flex flex-col justify-center items-center mt-4">
            Formatting note...
        </div>
        )}


        {/* Tabs Component for Raw Transcript and Markdown Editor */}
        {/* only show tabs when there is a raw transcript and markdown */}
        {form.getValues("noteContentRaw") != '' && (
        <Tabs defaultValue="transcript" className="w-full mt-4">
            <TabsList className="flex w-full">
                <TabsTrigger className='grow' value="transcript">Raw Transcript</TabsTrigger>
                <TabsTrigger className='grow' value="markdown">Markdown Editor</TabsTrigger>
            </TabsList>

            <TabsContent value="transcript">
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
            </TabsContent>

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
                        readOnly={gettingMarkdown}
                        markdown={form.getValues("noteContentMarkdown")}
                        onChange={(value) => {
                            form.setValue("noteContentMarkdown", value);
                            setMarkdown(value);
                        }}
                    />
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