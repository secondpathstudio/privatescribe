import { Breadcrumbs } from '@/components/ui/breadcrumb'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import NewNoteForm from './new-note-form'

const NewNote = () => {
  return (
    <div className="max-w-screen-lg mx-auto px-4 py-10">
        <Breadcrumbs 
          notes={[
            {
              label: "All Notes",
              href: '/notes',
            },
            {
              label: "New Note",
            },
          ]}
          />
        <h1 className='text-4xl font-black mt-6'>Create Note</h1>
        <Card className='mt-5'>
          <CardHeader>
            <CardTitle>
              <NewNoteForm />
            </CardTitle>
          </CardHeader>
        </Card>
    </div>
  )
}

export default NewNote