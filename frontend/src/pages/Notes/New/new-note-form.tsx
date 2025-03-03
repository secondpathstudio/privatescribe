import NoteForm from "@/components/note-form"
import { useAuth } from "@/context/auth-context"

const NewNoteForm = () => {
  const auth = useAuth();

  const handleAddNewNote = async (form: any) => {
    
    const formValues = form.getValues();
    console.log('submitting note', formValues);

    try {
      const response = await fetch('http://127.0.0.1:5000/api/notes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auth.token}`,
        },
        body: JSON.stringify(formValues)
      });

      if (!response.ok) {
        throw new Error('Network request failed with status ' + response.status);
      } else {
        //note created
        console.log('note created successfully', response)
      }
    } catch (error) {
      console.log('Error submitting note: ', error)
    }
  }

  return (
    <div>
      <NoteForm addNewNote={handleAddNewNote} />
    </div>
  )
}

export default NewNoteForm