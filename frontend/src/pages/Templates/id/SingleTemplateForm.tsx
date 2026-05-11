import React, { FormEvent, useEffect } from 'react'
import { useForm, useFormState } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import MarkdownEditor from '@/components/md-editor'
import { BoldItalicUnderlineToggles, headingsPlugin, listsPlugin, ListsToggle, MDXEditorMethods, quotePlugin, toolbarPlugin, UndoRedo } from '@mdxeditor/editor'
import { useAuth } from '../../../context/auth-context'
import PirateWheel from '@/components/PirateWheel'
import NeoButton from '@/components/neo/neo-button'
import { useNavigate } from 'react-router'
import { Trash2 } from 'lucide-react'

// Mirrors backend caps in app.py (TEMPLATE_NAME_MAX, TEMPLATE_CONTENT_MAX)
const TEMPLATE_NAME_MAX = 50;
const TEMPLATE_CONTENT_MAX = 32_000;

const templateSchema = z.object({
    name: z.string().min(1, 'Name is required').max(TEMPLATE_NAME_MAX, `Name must be ${TEMPLATE_NAME_MAX} characters or fewer`),
    content: z.string().min(1, 'Content is required').max(TEMPLATE_CONTENT_MAX, `Content must be ${TEMPLATE_CONTENT_MAX} characters or fewer`),
    llmModel: z.string().min(1, 'Select a model'),
}).passthrough();

type Props = {
    template: any;
}

const SingleTemplateForm = ({ template }: Props) => {
    const auth = useAuth();
    const mdxEditorRef = React.useRef<MDXEditorMethods>(null);
    const [updating, setUpdating] = React.useState(false);
    const [models, setModels] = React.useState<{ name: string; parameter_size?: string | null }[]>([]);
    const [modelsError, setModelsError] = React.useState<string | null>(null);
    const navigate = useNavigate();

    const form = useForm({
        resolver: zodResolver(templateSchema),
        mode: 'onChange',
        defaultValues: {
            name: template?.name,
            content: template?.content,
            llmModel: template?.llmModel || '',
            version: template?.version,
            authorId: template?.authorId,
            createdAt: template?.createdAt,
            updatedAt: template?.updatedAt,
        }
    });

    useEffect(() => {
        const fetchModels = async () => {
            try {
                const response = await fetch('http://127.0.0.1:5000/api/ollama/models', {
                    headers: { 'Authorization': `Bearer ${auth.token}` },
                });
                const data = await response.json();
                if (!response.ok) {
                    setModelsError(data.error || 'Could not load models');
                    setModels([]);
                    return;
                }
                setModels(data.models || []);
                setModelsError(null);
            } catch (err) {
                console.log('Error fetching models', err);
                setModelsError('Could not reach the server');
            }
        };
        fetchModels();
    }, [auth.token]);

    const formState = useFormState({
        control: form.control,})

    const handleUpdateTemplate = async (e: FormEvent, form: any) => {
        e.preventDefault();
        setUpdating(true);
        const formValues = form.getValues();

        try {
            const response = await fetch(`http://127.0.0.1:5000/api/templates/${template.id}`, {
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
                //template updated
                const data = await response.json();
                console.log('Template updated:', data);

                //update form default values
                form.reset({
                    name: data.name,
                    content: data.content,
                    llmModel: data.llmModel || '',
                    version: data.version,
                    authorId: data.authorId,
                    createdAt: data.createdAt,
                    updatedAt: data.updatedAt,
                });
            }
        } catch (error) {
            alert('Error submitting template. Please try again.');
            console.log('Error submitting template: ', error)
        }
        setUpdating(false);
    }

    const handleDeleteTemplate = async () => {
        const formValues = form.getValues();
        
        setUpdating(true);
        try {
            const response = await fetch(`http://127.0.0.1:5000/api/templates/${template.id}/delete`, {
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
                console.log('Template marked for deletion:', data);
                
                if (data.message) {
                    setUpdating(false);
                    alert(data.message + ' - Redirecting to notes page');
                    
                    //redirect to notes page
                    navigate('/templates');
                }
                


            }
        } catch (error) {
            alert('Error deleting template. Please try again.');
            console.log('Error deleting template: ', error)
            setUpdating(false);
        }
    }

    const handleUndeleteTemplate = async () => {
        const formValues = form.getValues();
        
        setUpdating(true);
        try {
            const response = await fetch(`http://127.0.0.1:5000/api/templates/${template.id}/restore`, {
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
                console.log('Template restored:', data);
                
                if (data.message) {
                    setUpdating(false);
                    alert(data.message + ' - Redirecting to templates page');
                    
                    //redirect to notes page
                    navigate('/templates');
                }
                


            }
        } catch (error) {
            alert('Error restoring template. Please try again.');
            console.log('Error restoring template: ', error)
            setUpdating(false);
        }
    }
    

  return (
    <Form {...form}>
    <form onSubmit={(e) => handleUpdateTemplate(e, form)}>
        <div className="flex flex-col">
            <fieldset className="flex justify-between items-center gap-2">
                <FormField
                    control={form.control} 
                    name="name" 
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Template Name</FormLabel>
                            <FormControl>
                                <Input {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="llmModel"
                    render={({ field }) => (
                        <FormItem className="flex flex-col">
                            <FormLabel>LLM Model</FormLabel>
                            <FormControl>
                                <Select
                                    onValueChange={(value) => {
                                        field.onChange(value);
                                        form.setValue('llmModel', value, { shouldDirty: true, shouldValidate: true });
                                    }}
                                    value={field.value}
                                    disabled={models.length === 0}
                                >
                                    <SelectTrigger className='z-10 bg-white min-w-[200px]'>
                                        <SelectValue placeholder={models.length === 0 ? (modelsError || "Loading models...") : "Select a model"} />
                                    </SelectTrigger>
                                    <SelectContent className='z-10 bg-white'>
                                        {models.map((m) => (
                                            <SelectItem key={m.name} value={m.name} className='hover:bg-[#fd3777]'>
                                                {m.name}
                                                {m.parameter_size && (
                                                    <span className="ml-2 text-xs text-muted-foreground">({m.parameter_size})</span>
                                                )}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </FormControl>
                            <FormMessage />
                            {modelsError && (
                                <p className="text-xs text-red-600">{modelsError}</p>
                            )}
                        </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="authorId"
                    render={({ field }) => (
                        <FormItem className="flex flex-col">
                            <FormLabel>Author ID</FormLabel>
                            <FormControl>
                                <Input {...field} disabled />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            </fieldset>
            <fieldset>
                <FormField
                    control={form.control}
                    name="content"
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
                                        form.setValue('content', value, { shouldDirty: true, shouldValidate: true });
                                    }}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            </fieldset>
        </div>

        {/* animation for server processing */}
        {updating && (
        <div className="flex flex-col w-full justify-center items-center mt-4">
            <PirateWheel isRotating={true} />
            <p className="text-primary">Transcribing audio...</p>
        </div>
        )}

       
        
        {/* Buttons */}
        {updating && (
            <div className="flex flex-col w-full justify-center items-center mt-4">
                <PirateWheel isRotating={true} />
                <p className="text-primary">Saving note...</p>
            </div>
        )}
        {!updating && (
        <div className='flex justify-between items-center gap-4 mt-4'>
            <NeoButton 
                type="submit"
                disabled={!formState.isDirty || !formState.isValid}
                backgroundColor='#fd3777'
                textColor='#ffffff'
            >
                {updating ? "Saving..." : "Save Template"}
            </NeoButton>
            <div className='flex gap-4 items-center'>
                <NeoButton 
                    type="button"
                    disabled={!formState.isDirty || !formState.isValid}
                    onClick={() => {
                        form.reset();
                        mdxEditorRef.current?.setMarkdown(template?.content);
                    }}
                >
                    Reset
                </NeoButton>
                {template.isDeleted ? (
                    <NeoButton
                        type="button"
                        label="Restore"
                        onClick={handleUndeleteTemplate}
                    />
                ): (
                <NeoButton 
                    type="button"
                    onClick={handleDeleteTemplate}
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

export default SingleTemplateForm