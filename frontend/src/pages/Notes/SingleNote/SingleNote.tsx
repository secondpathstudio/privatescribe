import { API_BASE } from "@/lib/api";
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
  const [savedParticipants, setSavedParticipants] = useState<any[]>([]);
  const [siblings, setSiblings] = useState<any[]>([]);

  useEffect(() => {
    const fetchNote = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/notes/${id}`, {
          method: 'GET',
          headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auth.token}`,
          },
      });
        const data = await response.json()
        // console.log('Fetched note: ', data)
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
        const response = await fetch(`${API_BASE}/api/templates/user/${auth.user?.id}`, {
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

useEffect(() => {
    const fetchSavedParticipants = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/participants/${auth.user?.id}`, {
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

          setSavedParticipants(data);
        }
      } catch (error) {
        console.log('Error fetching participants: ', error)
      }
    }

    fetchSavedParticipants();
  }, []);

  useEffect(() => {
    if (!id) return;
    const fetchSiblings = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/notes/${id}/siblings`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${auth.token}`,
          },
        });
        if (!response.ok) return;
        setSiblings(await response.json());
      } catch (error) {
        console.log('Error fetching siblings: ', error);
      }
    };
    fetchSiblings();
  }, [id]);


  const formatNoteDate = (value: string | null | undefined) => {
    if (!value) return '';
    const d = new Date(value);
    return isNaN(d.getTime()) ? value : d.toLocaleDateString(undefined, { dateStyle: 'medium' });
  };

  const templateName = note?.noteTemplate
    ? templates.find((t: any) => t.id === note.noteTemplate)?.name
    : undefined;
  const dateLabel = formatNoteDate(note?.noteDate || note?.createdAt);
  const title = note
    ? [templateName || 'Note', dateLabel].filter(Boolean).join(' — ')
    : 'Note';

  return (
    <div className="max-w-screen-lg mx-auto px-4 py-10">
        <Breadcrumbs
          notes={[
            {
              label: "All Notes",
              href: '/notes',
            },
            {
              label: title,
            },
          ]}
          />
        <h1 className='text-4xl font-black mt-6'>{title}</h1>
        <Card className='mt-5'>
          <CardHeader>
            <CardTitle>
              {note &&
              <SingleNoteForm
                key={note.id}
                note={note}
                templates={templates}
                savedParticipants={savedParticipants}
                siblings={siblings}
              />
              }
            </CardTitle>
          </CardHeader>
        </Card>
    </div>
  )
}

export default SingleNote