'use client'

import { ForwardedRef } from 'react'
import {
    headingsPlugin,
    listsPlugin,
    quotePlugin,
    thematicBreakPlugin,
    markdownShortcutPlugin,
    MDXEditor,
    type MDXEditorMethods,
    type MDXEditorProps
  } from '@mdxeditor/editor'
import '@mdxeditor/editor/style.css'

export default function MarkdownEditor({
    editorRef,
    ...props
  }: { editorRef: ForwardedRef<MDXEditorMethods> | null } & MDXEditorProps) {
  return (
    <div className='w-full flex flex-col justify-center items-center'>
        <MDXEditor
        plugins={[
            // Example Plugin Usage
            headingsPlugin(),
            listsPlugin(),
            quotePlugin(),
            thematicBreakPlugin(),
            markdownShortcutPlugin()
        ]}
        {...props}
        ref={editorRef}
        />
    </div>
  )
}