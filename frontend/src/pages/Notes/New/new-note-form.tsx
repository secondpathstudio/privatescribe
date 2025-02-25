import NoteForm from "@/components/note-form"
import { useAuth } from "@/context/auth-context"

const NewNoteForm = () => {
  const auth = useAuth();

  const handleNoteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    //send to server
  }

  return (
    <div>
      <NoteForm handleSubmit={handleNoteSubmit} />
    </div>
  )
}

export default NewNoteForm