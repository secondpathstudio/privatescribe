import { Breadcrumbs } from '@/components/ui/breadcrumb'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { useEffect, useState } from 'react'
import SingleNoteForm from './single-note-form'
import { useParams } from 'react-router'
import { useAuth } from '@/context/auth-context'



const SingleNote = () => {
  const [note, setNote] = useState<any>(null)
  const { id } = useParams()
  const auth = useAuth();

  useEffect(() => {
    const fetchNote = async () => {
      console.log('fetching note', id)
      try {
        const response = await fetch(`http://127.0.0.1:5000/api/notes/${id}`, {
          method: 'GET',
          headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auth.token}`,
          },
      });
        const data = await response.json()
        console.log('received note data', data)
        setNote(data)
      }
      catch (error) {
        console.error(error)
      }
    }

    fetchNote()
  }, [id])


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
        <h1 className='text-4xl font-bold mt-6'>Note {note?.id}</h1>
        <Card className='mt-5'>
          <CardHeader>
            <CardTitle>
              {note && 
              <SingleNoteForm note={note} />
              }
            </CardTitle>
          </CardHeader>
        </Card>
    </div>
  )
}

export default SingleNote