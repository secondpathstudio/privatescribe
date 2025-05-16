import React, { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import MarkdownEditor from '@/components/md-editor'
import { BoldItalicUnderlineToggles, headingsPlugin, listsPlugin, ListsToggle, MDXEditorMethods, quotePlugin, toolbarPlugin, UndoRedo } from '@mdxeditor/editor'
import { useAuth } from '../../../context/auth-context'
import PirateWheel from '@/components/PirateWheel'
import { useNavigate } from 'react-router'
import NeoButton from '@/components/neo/neo-button'


const NewTemplateForm = () => {
    const auth = useAuth();
    const mdxEditorRef = React.useRef<MDXEditorMethods>(null)
    const [markdown, setMarkdown] = React.useState('');
    const [savingTemplate, setSavingTemplate] = React.useState(false);

    const handleAddNewTemplate = async (form: any) => {
        setSavingTemplate(true);
        const formValues = form.getValues();
        console.log('submitting note', formValues);
        const navigate = useNavigate();

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
                //redirect to new template
                const data = await response.json();
                console.log('Template created:', data);
                navigate(`/templates/${data.id}`);
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
        defaultValues: {
            name: '',
            content: '',
            version: 1,
            authorId: auth.user?.id
        }
    });

  return (
    <Form {...form}>
    <form onSubmit={handleAddNewTemplate}>
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
            <p className="text-primary">Transcribing audio...</p>
        </div>
        )}

       
        
        {/* Buttons */}
        {savingTemplate && (
            <div className="flex flex-col w-full justify-center items-center mt-4">
                <PirateWheel isRotating={true} />
                <p className="text-primary">Saving note...</p>
            </div>
        )}
        {!savingTemplate && (
        <div className='flex justify-center items-center gap-4'>
            <NeoButton 
                type="submit"
                disabled={form.getValues("content") === '' || form.getValues('name') === '' || form.formState.isSubmitting}
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