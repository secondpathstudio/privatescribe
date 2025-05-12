// import MarkdownEditor from '@/components/md-editor';
import { MDXEditor } from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css'
import { Breadcrumbs } from '@/components/ui/breadcrumb'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { headingsPlugin, quotePlugin, listsPlugin, toolbarPlugin, UndoRedo, BoldItalicUnderlineToggles, ListsToggle } from '@mdxeditor/editor';
import { useRef, useState } from 'react';

const NewTemplate = () => {
  const [markdownTemplate, setMarkdownTemplate] = useState("");
  const markdownExample = `## Example Template
    - **Name:** [speaker's name]
    - **Role:** [Enter speaker's role]

    ## Date and Time
    - **Date:** [Enter date]
    - **Time:** [Enter time]

    ## Context
    [Provide a brief description of the context or purpose of the dictation]

    ## Notes
    - [Add any additional notes or observations here]
    `;

  return (
    <div className="max-w-screen-lg mx-auto px-4 py-10">
        <Breadcrumbs 
          notes={[
            {
              label: "All Templates",
              href: '/templates',
            },
            {
              label: "New Template",
            },
          ]}
          />
        <h1 className='text-4xl font-bold mt-6'>Create Template</h1>
        <Card className='mt-5'>
          <CardHeader>
            <CardTitle>
              <div className='flex flex-col space-y-4'>
                <h2 className='text-2xl font-bold'>New Template Name</h2>
                <MDXEditor 
                  markdown='hello world'
                  plugins={[
                    headingsPlugin(),
                    quotePlugin(),
                    listsPlugin(),
                    toolbarPlugin({
                      toolbarContents: () => (
                        <>
                          <UndoRedo />
                          <BoldItalicUnderlineToggles />
                        </>
                      )
                    })
                  ]}
                />
              </div>
            </CardTitle>
          </CardHeader>
        </Card>
    </div>
  )
}

export default NewTemplate