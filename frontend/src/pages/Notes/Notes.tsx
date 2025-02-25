import { Breadcrumbs } from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import NoteTableEntry from './note-table-entry'
import { Link } from 'react-router'

const Notes = () => {
  return (
    <div className="max-w-screen-lg mx-auto px-4 py-10">
      <Breadcrumbs 
        notes={[
          {
            label: "All Notes",
          },
        ]}
      />

      <h1 className='text-4xl font-bold mt-6'>All Notes</h1>
      <Button asChild className='inline-flex pl-2 gap-2 mt-4'>
        <Link to='/notes/new'>
          📝 Create Note
        </Link>
      </Button>
        
      <div>
        <NoteTableEntry />
      </div>
    </div>
  )
}

export default Notes