import { Breadcrumbs } from '@/components/ui/breadcrumb'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import NewNoteForm from './NewNoteForm'
import { useEffect, useState } from 'react'
import { useAuth } from '@/context/auth-context'

const NewNote = () => {
  const auth = useAuth()
  const [templates, setTemplates] = useState([]);

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
              label: "New Note",
            },
          ]}
          />
        <h1 className='text-4xl font-black mt-6'>Create Note</h1>
        <Card className='mt-5'>
          <CardHeader>
            <CardTitle>
              {!templates && <p className='text-sm text-muted-foreground'>Loading templates...</p>}
              {templates && templates.length === 0 && <p className='text-sm text-muted-foreground'>No templates found</p>}
              {templates && templates.length > 0 && 
                <NewNoteForm templates={templates} />
              }
            </CardTitle>
          </CardHeader>
        </Card>
    </div>
  )
}

export default NewNote