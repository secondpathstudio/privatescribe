import React, { FormEvent, ReactEventHandler, useEffect } from 'react'
import { useForm, useFormState } from 'react-hook-form'
import { format } from 'date-fns'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { CalendarIcon, Trash2 } from 'lucide-react'
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
}

const SingleTemplateForm = ({ note }: Props) => {
    const auth = useAuth();
    const mdxEditorRef = React.useRef<MDXEditorMethods>(null);
    const [updating, setUpdating] = React.useState(false);
    const navigate = useNavigate();
    
    const form = useForm({
        defaultValues: {
            patientId: note?.patientId,
            providerId: note?.providerId,
            providerName: note?.providerName,
            encounterDate: note?.encounterDate,
            noteContentRaw: note?.noteContentRaw,
            noteContentMarkdown: note?.noteContentMarkdown,
            noteType: note?.noteType,
            version: note?.version,
            createdAt: note?.createdAt,
            updatedAt: note?.updatedAt,
        }
    });

    const formState = useFormState({
        control: form.control,})

    const handleUpdateNote = async (e: FormEvent, form: any) => {
        e.preventDefault();
        setUpdating(true);
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
        setUpdating(false);
    }
    
    const getDateString = () => {
        const date = new Date();
        return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}-${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}`;
    }

    const handleDeleteNote = async () => {
        const formValues = form.getValues();
        
        setUpdating(true);
        try {
            const response = await fetch(`http://127.0.0.1:5000/api/notes/${note.id}/delete`, {
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
                //note marked for deletion
                const data = await response.json();
                console.log('Note marked for deletion:', data);
                
                if (data.message) {
                    setUpdating(false);
                    alert(data.message + ' - Redirecting to notes page');
                    
                    //redirect to notes page
                    navigate('/notes');
                }
                


            }
        } catch (error) {
            alert('Error deleting note. Please try again.');
            console.log('Error deleting note: ', error)
            setUpdating(false);
        }
    }
        
    

  return (
    <Form {...form}>
    <form onSubmit={(e) => handleUpdateNote(e, form)}>
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
        {updating && (
            <div className="flex flex-col w-full justify-center items-center mt-4">
                <PirateWheel isRotating={true} />
                <p className="text-primary">Saving note...</p>
            </div>
        )}
        {!updating && form.getValues("noteContentRaw") && form.getValues("noteContentMarkdown") && (
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
                <NeoButton 
                    type="button"
                    onClick={() => confirm('Are you sure you want to delete this note?') && handleDeleteNote()}
                >
                    <Trash2 />
                </NeoButton>
            </div>
        </div>
        )}
    </form>
</Form>

  )
}

export default SingleTemplateForm