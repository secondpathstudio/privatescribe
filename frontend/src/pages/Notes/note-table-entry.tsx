import NeoButton from '@/components/neo/neo-button';
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card';
import { Link } from 'react-router'

type Props = {
  note: {
    id: number;
    patientId: number;
    encounterDate: Date;
    chiefComplaint: string;
    noteContentMarkdown: string;
    noteType: string;
  }
}

const NoteTableEntry = (props: Props) => {
  return (
    <Card className='mt-6'>
        <div className='bg-white shadow-md rounded-md'>
        <div className='p-4 flex justify-between items-center'>
            <div>
            <h4 className='text-xs italic flex gap-2 items-center'>
              {props.note.encounterDate.toString()} - {props.note.noteType}
            </h4>
            <h2 className='text-xl font-bold'>{props.note.patientId}</h2>
            <p className='text-gray-600'>Chief Complaint + {props.note.noteContentMarkdown.slice(0,15)}</p>
            </div>
            <div className='mt-4'>
            <NeoButton>
                <Link to={`/notes/${props.note.id}`}>
                View
                </Link>
            </NeoButton>
            </div>
        </div>
        </div>
    </Card>
  )
}

export default NoteTableEntry