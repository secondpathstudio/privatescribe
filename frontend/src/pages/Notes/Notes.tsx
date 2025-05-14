import { Breadcrumbs } from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import NoteTableEntry from './note-table-entry'
import { Link } from 'react-router'
import { useEffect, useState } from 'react'
import { useAuth } from '@/context/auth-context'
import NeoButton from '@/components/neo/neo-button'

const Notes = () => {
  const [notes, setNotes] = useState([]);
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
          throw new Error('Network request failed with status ' + response.status);
        } else {
          const data = await response.json();
          setNotes(data);
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
      <h1 className='text-4xl font-bold mt-6'>All Notes</h1>
      <NeoButton backgroundColor='#fd3777' textColor='#ffffff'>
        <Link to='/notes/new'>
          📝 Create Note
        </Link>
      </NeoButton>
      </div>
        
      <div>
        {loading && <p>Loading...</p>}
        {notes.length === 0 && !loading && <p>No notes found</p>}
        {notes.length > 0 && notes.map((note: any) => (
          <NoteTableEntry key={note.id} note={note} />
        ))}
      </div>
    </div>
  )
}

export default Notes