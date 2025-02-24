import NoteForm from "@/components/note-form"

const NewNoteForm = () => {
  const handleNoteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('submit note');

    //send to server
  }

  return (
    <div>
      <NoteForm handleSubmit={handleNoteSubmit} />
    </div>
  )
}

export default NewNoteForm