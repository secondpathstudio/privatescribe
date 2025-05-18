import React, { FormEvent, ReactEventHandler, useEffect } from 'react'
import { useForm, useFormState } from 'react-hook-form'
import { format } from 'date-fns'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { ArchiveRestore, CalendarIcon, RefreshCcw, Trash, Trash2 } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import MarkdownEditor from '@/components/md-editor'
import { BoldItalicUnderlineToggles, headingsPlugin, listsPlugin, ListsToggle, MDXEditorMethods, quotePlugin, toolbarPlugin, UndoRedo } from '@mdxeditor/editor'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '../../../context/auth-context'
import PirateWheel from '@/components/PirateWheel'
import NeoButton from '@/components/neo/neo-button'
import { useNavigate } from 'react-router'

type Props = {
    note: any;
    templates: any[];
}

const SingleNoteForm = ({ note, templates }: Props) => {
    const auth = useAuth();
    const mdxEditorRef = React.useRef<MDXEditorMethods>(null);
    const [savingNote, setSavingNote] = React.useState(false);
    const [selectedTemplateName, setSelectedTemplateName] = React.useState('');
    const navigation = useNavigate();

    const form = useForm({
        defaultValues: {
            authorId: note?.authorId,
            authorName: note?.authorName,
            noteDate: note?.noteDate,
            noteContentRaw: note?.noteContentRaw,
            noteContentMarkdown: note?.noteContentMarkdown,
            noteType: note?.noteType,
            version: note?.version,
            createdAt: note?.createdAt,
            updatedAt: note?.updatedAt,
            participants: note?.participants || '',
            noteTemplate: note?.noteTemplate ? templates.find((template) => template.id === note.noteTemplate)?.id : 1,
        }
    });

    const formState = useFormState({
        control: form.control,})

    const handleUpdateNote = async (e: FormEvent, form: any) => {
        e.preventDefault();
        setSavingNote(true);
        const formValues = form.getValues();
        console.log('submitting note', formValues);

        try {
            const response = await fetch(`http://127.0.0.1:5000/api/notes/${note.id}`, {
                method: 'PUT',
                headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${auth.token}`,
                },
                body: JSON.stringify(formValues)
            });

            if (!response.ok) {
                throw new Error('Network request failed with status ' + response.status);
            } else {
                //note created
                //redirect to new note
                const data = await response.json();
                console.log('Note updated:', data);
            }
        } catch (error) {
            alert('Error submitting note. Please try again.');
            console.log('Error submitting note: ', error)
        }
        setSavingNote(false);
    }
    
    const handleDeleteNote = async () => {
        if (confirm('Are you sure you want to delete this note?')) {
            try {
                const response = await fetch(`http://127.0.1:5000/api/notes/${note.id}/delete`, {
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

    const handleRestoreNote = async () => {
        if (confirm('Are you sure you want to restore this note?')) {
            try {
                const response = await fetch(`http://127.0.1:5000/api/notes/${note.id}/restore`, {
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

  return (
    <Form {...form}>
    <form onSubmit={(e) => handleUpdateNote(e, form)}>
        <div className="grid grid-cols-2 gap-4">
            <fieldset className="flex flex-col gap-2">
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
                    name="participants" 
                    render={({ field }) => (
                        <FormItem className="flex flex-col">
                            <FormLabel>Participants</FormLabel>
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
                    name="noteDate" 
                    render={({ field }) => (
                        <FormItem className="flex flex-col">
                            <FormLabel>Note Date</FormLabel>
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
                    name="authorName" 
                    render={({ field }) => (
                        <FormItem className="flex flex-col">
                            <FormLabel>Author Name</FormLabel>
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
                <FormField
                    control={form.control}
                    name="noteContentMarkdown"
                    render={({ field }) => (
                        <FormItem className="w-full mt-4">
                            <FormControl>
                                <MarkdownEditor 
                                    className="w-full"
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
        </Tabs>
        )}
        
        {/* Buttons */}
        {savingNote && (
            <div className="flex flex-col w-full justify-center items-center mt-4">
                <PirateWheel isRotating={true} />
                <p className="text-primary">Saving note...</p>
            </div>
        )}
        {!savingNote && form.getValues("noteContentRaw") && form.getValues("noteContentMarkdown") && (
        <div className='flex justify-between items-center gap-4 mt-4'>
            <NeoButton 
                type="submit"
                backgroundColor='#fd3777'
                textColor='#ffffff'
            >
                Save Note
            </NeoButton>
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
                    <NeoButton 
                    type="button"
                    onClick={handleRestoreNote}
                >
                    <span className='flex gap-2 items-center justify-center'>Restore <RefreshCcw /></span>
                </NeoButton>
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
    </form>
</Form>

  )
}

export default SingleNoteForm