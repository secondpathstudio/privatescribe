import { Breadcrumbs } from '@/components/ui/breadcrumb'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { useEffect, useState } from 'react'
import SingleNoteForm from './SingleNoteForm'
import { useParams } from 'react-router'
import { useAuth } from '@/context/auth-context'



const SingleNote = () => {
  const [note, setNote] = useState<any>(null)
  const { id } = useParams()
  const auth = useAuth();
  const [templates, setTemplates] = useState<any[]>([]);

  useEffect(() => {
    const fetchNote = async () => {
      try {
        const response = await fetch(`http://127.0.0.1:5000/api/notes/${id}`, {
          method: 'GET',
          headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auth.token}`,
          },
      });
        const data = await response.json()
        console.log('Fetched note: ', data)
        setNote(data)
      }
      catch (error) {
        console.error('Error fetching note: ', error)
      }
    }

    fetchNote()
  }, [id])

  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        const response = await fetch(`http://127.0.0.1:5000/api/templates/user/${auth.user?.id}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${auth.token}`,
          },
        });

        if (!response.ok) {
          console.log('Invalid server response: ', response)
          throw new Error('Network request failed with status ' + response.status);
        } else {
          const data = await response.json();
          setTemplates(data);
        }
      } catch (error) {
        console.log('Error fetching templates: ', error)
      }
    }

    fetchTemplates();
  }, []);


  return (
    <div className="max-w-screen-lg mx-auto px-4 py-10">
        <Breadcrumbs 
          notes={[
            {
              label: "All Notes",
              href: '/notes',
            },
            {
              label: `${note?.createdAt}`,
            },
          ]}
          />
        <h1 className='text-4xl font-black mt-6'>{note?.createdAt}</h1>
        <Card className='mt-5'>
          <CardHeader>
            <CardTitle>
              {note && 
              <SingleNoteForm note={note} templates={templates} />
              }
            </CardTitle>
          </CardHeader>
        </Card>
    </div>
  )
}

export default SingleNote