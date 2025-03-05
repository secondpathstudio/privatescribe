import React, { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { format, getDate, set } from 'date-fns'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from './ui/form'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Calendar } from './ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Button } from './ui/button'
import { CalendarIcon } from 'lucide-react'
import { Textarea } from './ui/textarea'
import Microphone from './recording/microphone'
import { Input } from './ui/input'
import MarkdownEditor from './md-editor'
import { BoldItalicUnderlineToggles, headingsPlugin, listsPlugin, ListsToggle, MDXEditorMethods, quotePlugin, toolbarPlugin, UndoRedo } from '@mdxeditor/editor'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { useAuth } from '../context/auth-context'
import PirateWheel from './PirateWheel'

type Props = {
    addNewNote: (form: any) => Promise<void>;
}

const NoteForm = ({addNewNote} : Props) => {
    const auth = useAuth();
    const mdxEditorRef = React.useRef<MDXEditorMethods>(null)
    const [gettingMarkdown, setGettingMarkdown] = React.useState(false);
    const [markdown, setMarkdown] = React.useState('');
    const [isTranscribing, setIsTranscribing] = React.useState(false);
    const [microphoneKey, setMicrophoneKey] = React.useState(0);

    console.log('auth', auth);
    
    const getDateString = () => {
        const date = new Date();
        return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}-${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}`;
    }

    const form = useForm({
        defaultValues: {
            patientId: getDateString(),
            providerId: auth.user?.id,
            providerName: auth.user?.firstName + ' ' + auth.user?.lastName,
            encounterDate: new Date(),
            noteContentRaw: '',
            noteContentMarkdown: '',
            noteType: 'visit',
            version: 1,
            status: 'draft',
        }
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()

        addNewNote({...form, encounterDate: form.getValues('encounterDate').toISOString()});
    }

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
            if (result.raw_transcript === '') {
                alert('Transcription unable to identify speech. Please try again.');
                setIsTranscribing(false);
                return;
            }

            form.setValue('noteContentRaw', result.raw_transcript);

            // Format the transcription in Markdown
            getMarkdown(result.raw_transcript);
        } catch (error: any) {
            console.error('Upload failed:', error);
            alert(`Upload failed: ${error.message}`);
        }
        setIsTranscribing(false);
    }

    const getMarkdown = async (rawTranscript: string) => {
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
                    raw_transcript: rawTranscript,
                    visit_details: {
                        patient_id: form.getValues('patientId'),
                        encounter_date: form.getValues('encounterDate'),
                        note_type: form.getValues('noteType'),
                        ProviderId: form.getValues('providerId'),
                    }
                 }),
            });

            if (!response.ok) {
                throw new Error(`Server error: ${response.status}`);
            }

            const result = await response.json();
            form.setValue('noteContentMarkdown', result.formatted_markdown);
            mdxEditorRef.current?.setMarkdown(result.formatted_markdown);
        } catch (error: any) {
            console.error('Failed to get markdown:', error);
        } 
        setGettingMarkdown(false);
    }

  return (
    <Form {...form}>
    <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-2 gap-4">
            <fieldset className="flex flex-col gap-2">
                <FormField 
                    control={form.control} 
                    name="noteType" 
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Note Type</FormLabel>
                            <FormControl>
                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="visit">Visit</SelectItem>
                                        <SelectItem value="procedure">Progress Note</SelectItem>
                                        <SelectItem value="lab">Lab</SelectItem>
                                        <SelectItem value="imaging">Imaging</SelectItem>
                                        <SelectItem value="discharge">Discharge</SelectItem>
                                    </SelectContent>
                                </Select>
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField 
                    control={form.control} 
                    name="patientId" 
                    render={({ field }) => (
                        <FormItem className="flex flex-col">
                            <FormLabel>Patient ID</FormLabel>
                            <FormControl>
                                <Input {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            </fieldset>
            <fieldset className="flex flex-col gap-2">
                <FormField 
                    control={form.control} 
                    name="encounterDate" 
                    render={({ field }) => (
                        <FormItem className="flex flex-col">
                            <FormLabel>Encounter Date</FormLabel>
                            <FormControl>
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button variant="outline" color="primary" size="sm">
                                            {field.value ? format(field.value, "PPP") : <span>Select a date</span>}
                                            <CalendarIcon className="w-4 h-4 mr-2" />
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0">
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
                <FormField 
                    control={form.control} 
                    name="providerName" 
                    render={({ field }) => (
                        <FormItem className="flex flex-col">
                            <FormLabel>Provider</FormLabel>
                            <FormControl>
                                <Input 
                                    disabled 
                                    placeholder="Provider Name"
                                    {...field}
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
            <PirateWheel isRotating={true} />
            <p className="text-primary">Transcribing audio...</p>
        </div>
        )}

        {gettingMarkdown && (
        <div className="flex flex-col justify-center items-center mt-4">
            <PirateWheel isRotating={true} />
            <p className="text-primary">Creating formatted note...</p>
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
                            console.log("Setting markdown to:", value);
                        }}
                    />
            </TabsContent>
        </Tabs>
        )}
        
        {/* Save Button */}
        {form.getValues("noteContentRaw") && form.getValues("noteContentMarkdown") && (
        <div className='flex justify-center items-center gap-4'>
            <Button 
                type="submit"
                className="flex gap-2 max-w-md mx-auto mt-4 w-full bg-green-500 disabled:bg-gray-400"
                disabled={markdown === ''}
            >
                🛟 Save Note
            </Button>
            <Button 
                type="button"
                variant={'outline'}
                className="flex gap-2 max-w-md mx-auto mt-4 w-full disabled:opacity-50 hover:bg-red-500 cursor-pointer"
                onClick={() => {
                    form.reset();
                    setMarkdown('');
                    mdxEditorRef.current?.setMarkdown('');
                    setMicrophoneKey(microphoneKey + 1);
                }}
            >
                Reset
            </Button>
        </div>
        )}
    </form>
</Form>

  )
}

export default NoteForm