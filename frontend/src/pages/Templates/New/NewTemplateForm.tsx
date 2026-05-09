import React, { FormEvent, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import MarkdownEditor from '@/components/md-editor'
import { BoldItalicUnderlineToggles, headingsPlugin, listsPlugin, ListsToggle, MDXEditorMethods, quotePlugin, toolbarPlugin, UndoRedo } from '@mdxeditor/editor'
import { useAuth } from '../../../context/auth-context'
import PirateWheel from '@/components/PirateWheel'
import { useNavigate } from 'react-router'
import NeoButton from '@/components/neo/neo-button'
import '@mdxeditor/editor/style.css'

// Mirrors backend caps in app.py (TEMPLATE_NAME_MAX, TEMPLATE_CONTENT_MAX)
const TEMPLATE_NAME_MAX = 50;
const TEMPLATE_CONTENT_MAX = 32_000;

const templateSchema = z.object({
    name: z.string().min(1, 'Name is required').max(TEMPLATE_NAME_MAX, `Name must be ${TEMPLATE_NAME_MAX} characters or fewer`),
    content: z.string().min(1, 'Content is required').max(TEMPLATE_CONTENT_MAX, `Content must be ${TEMPLATE_CONTENT_MAX} characters or fewer`),
    llmModel: z.string().min(1, 'Select a model'),
}).passthrough();

const NewTemplateForm = () => {
    const auth = useAuth();
    const mdxEditorRef = React.useRef<MDXEditorMethods>(null)
    const [markdown, setMarkdown] = React.useState('');
    const [savingTemplate, setSavingTemplate] = React.useState(false);
    const [models, setModels] = React.useState<{ name: string; parameter_size?: string | null }[]>([]);
    const [modelsError, setModelsError] = React.useState<string | null>(null);
    const navigate = useNavigate();

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

    const handleAddNewTemplate = async (e: FormEvent, form: any) => {
        e.preventDefault();
        setSavingTemplate(true);
        const formValues = form.getValues();
        console.log('submitting template', formValues);
        
        try {
            const response = await fetch('http://127.0.0.1:5000/api/templates', {
                method: 'POST',
                headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${auth.token}`,
                },
                body: JSON.stringify(formValues)
            });

            if (!response.ok) {
                throw new Error('Network request failed with status ' + response.status);
            } else {
                //template created
                const data = await response.json();
                console.log('Template created:', data);
                
                //redirect to templates
                navigate(`/templates`);
            }
        } catch (error) {
            alert('Error creating template. Please try again.');
            console.log('Error creating template: ', error)
        }
        setSavingTemplate(false);
    }
    
    const getDateString = () => {
        const date = new Date();
        return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}-${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}`;
    }

    const form = useForm({
        resolver: zodResolver(templateSchema),
        mode: 'onChange',
        defaultValues: {
            name: '',
            content: 'New template',
            llmModel: '',
            version: 1,
            authorId: auth.user?.id
        }
    });

  return (
    <Form {...form}>
    <form onSubmit={(e) => handleAddNewTemplate(e, form)}>
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
                                    onValueChange={field.onChange}
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
                                        form.setValue('content', value, { shouldDirty: true });
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
        {savingTemplate && (
        <div className="flex flex-col w-full justify-center items-center mt-4">
            <PirateWheel isRotating={true} />
            <p className="text-primary">Saving template...</p>
        </div>
        )}
        
        {/* Buttons */}
        {!savingTemplate && (
        <div className='flex justify-center items-center gap-4'>
            <NeoButton
                type="submit"
                disabled={!form.formState.isValid || form.formState.isSubmitting}
            >
                Save Template
            </NeoButton>
            <NeoButton 
                type="button"
                onClick={() => {
                    form.reset();
                    setMarkdown('');
                    mdxEditorRef.current?.setMarkdown('');
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

export default NewTemplateForm