import React, { FormEvent } from 'react'
import { useForm, useFormState } from 'react-hook-form'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import MarkdownEditor from '@/components/md-editor'
import { BoldItalicUnderlineToggles, headingsPlugin, listsPlugin, ListsToggle, MDXEditorMethods, quotePlugin, toolbarPlugin, UndoRedo } from '@mdxeditor/editor'
import { useAuth } from '../../../context/auth-context'
import PirateWheel from '@/components/PirateWheel'
import NeoButton from '@/components/neo/neo-button'
import { useNavigate } from 'react-router'
import { Trash2 } from 'lucide-react'

type Props = {
    template: any;
}

const SingleTemplateForm = ({ template }: Props) => {
    const auth = useAuth();
    const mdxEditorRef = React.useRef<MDXEditorMethods>(null);
    const [updating, setUpdating] = React.useState(false);
    const navigate = useNavigate();
    
    const form = useForm({
        defaultValues: {
            name: template?.name,
            content: template?.content,
            version: template?.version,
            authorId: template?.authorId,
            createdAt: template?.createdAt,
            updatedAt: template?.updatedAt,
        }
    });

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
                disabled={!formState.isDirty}
                backgroundColor='#fd3777'
                textColor='#ffffff'
            >
                {updating ? "Saving..." : "Save Template"}
            </NeoButton>
            <div className='flex gap-4 items-center'>
                <NeoButton 
                    type="button"
                    disabled={!formState.isDirty}
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