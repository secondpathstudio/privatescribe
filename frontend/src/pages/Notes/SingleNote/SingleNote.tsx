import { API_BASE } from "@/lib/api";
import { Breadcrumbs } from '@/components/ui/breadcrumb'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { useEffect, useState } from 'react'
import SingleNoteForm from './SingleNoteForm'
import { useParams } from 'react-router'
import { useAuth } from '@/context/auth-context'
import NeoButton from '@/components/neo/neo-button'


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

  const [exporting, setExporting] = useState<'pdf' | 'docx' | null>(null);
  const handleExport = async (fmt: 'pdf' | 'docx') => {
    if (!note?.id || exporting) return;
    setExporting(fmt);
    try {
      const response = await fetch(`${API_BASE}/api/notes/${note.id}/export/${fmt}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!response.ok) {
        // Try to surface the server-side message (e.g. 503 when admin disabled).
        let msg = `Export failed (${response.status})`;
        try {
          const data = await response.json();
          if (data?.error) msg = data.error;
        } catch { /* not JSON */ }
        alert(msg);
        return;
      }
      const disposition = response.headers.get('Content-Disposition') || '';
      const match = /filename="?([^";]+)"?/.exec(disposition);
      const filename = match?.[1] || `note.${fmt}`;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('export error', err);
      alert('Export failed. Check the console for details.');
    } finally {
      setExporting(null);
    }
  };

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
        <div className='flex flex-wrap items-center justify-between gap-3 mt-6'>
          <h1 className='text-4xl font-black'>{title}</h1>
          {auth.user?.exportsEnabled && note && (
            <div className='flex items-center gap-2'>
              <NeoButton
                onClick={() => handleExport('pdf')}
                disabled={!!exporting}
                label={exporting === 'pdf' ? 'Preparing…' : '⬇ PDF'}
              />
              <NeoButton
                onClick={() => handleExport('docx')}
                disabled={!!exporting}
                label={exporting === 'docx' ? 'Preparing…' : '⬇ DOCX'}
              />
            </div>
          )}
        </div>
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