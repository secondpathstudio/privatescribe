import { Breadcrumbs } from '@/components/ui/breadcrumb'
import NoteTableEntry from './NoteTableEntry'
import { useEffect, useState } from 'react'
import { useAuth } from '@/context/auth-context'
import NeoLinkButton from '@/components/neo/neo-link-button'
import NeoButton from '@/components/neo/neo-button'

const Notes = () => {
  const [notes, setNotes] = useState([]);
  const [deletedNotes, setDeletedNotes] = useState([]);
  const [showDeleted, setShowDeleted] = useState(false);
  const [loading, setLoading] = useState(true);
  const auth = useAuth();

  useEffect(() => {
    const fetchNotes = async () => {
      setLoading(true);
      try {
        const response = await fetch(`http://127.0.0.1:5000/api/notes/user/${auth.user?.id}`, {
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

          if (data.length > 0) {
            const deleted = data.filter((note: any) => note.isDeleted);
            setDeletedNotes(deleted);

            const notDeleted = data.filter((note: any) => !note.isDeleted);
            setNotes(notDeleted);
          } else {
            setDeletedNotes([]);
            setNotes([]);
          }
        }
      } catch (error) {
        console.log('Error fetching notes: ', error)
      }
      setLoading(false);
    }

    fetchNotes();
  }, []);



  return (
    <div className="max-w-screen-lg mx-auto px-4 py-10">
      <Breadcrumbs 
        notes={[
          {
            label: "All Notes",
          },
        ]}
      />

      <div className='flex justify-between items-center'>
        <h1 className='text-4xl font-black mt-6'>All Notes</h1>
        <NeoLinkButton 
          route='/notes/new' 
          label='📝 Create Note' 
          backgroundColor='#fd3777' 
          textColor='#ffffff'
          />
      </div>
        
      <div>
        {loading && <p>Loading...</p>}
        {notes.length === 0 && !loading && <p>No notes found</p>}
        {!showDeleted && notes.length > 0 && notes.map((note: any) => (
          <NoteTableEntry key={note.id} note={note} />
        ))}
        {showDeleted && deletedNotes.length > 0 && deletedNotes.map((note: any) => (
          <NoteTableEntry key={note.id} note={note} />
        ))}
      </div>

      <div className='mt-10 w-full flex flex-col justify-center items-center'>
          <div className='mt-4 gap-4 w-full flex flex-col justify-center items-center'>
            {showDeleted && <p className='text-md italic text -[#fd3777]'>Deleted notes are permanently removed after 30 days.</p>}
            <NeoButton
              onClick={() => setShowDeleted(prev => !prev)}  
              label={showDeleted ? 'Hide Deleted Notes' : `${deletedNotes.length} Deleted Note ${deletedNotes.length > 1 ? 's' : ''}`}
              disabled={deletedNotes.length === 0}
            />
          </div>
      </div>
    </div>
  )
}

export default Notes