import NeoLinkButton from '@/components/neo/neo-link-button';
import { Card } from '@/components/ui/card';

type Props = {
  note: {
    id: number;
    noteDate: Date;
    noteContentMarkdown: string;
    noteType: string;
    authorName: string;
    isDeleted: boolean;
    isDeletedTimestamp: Date;
  }
}

const NoteTableEntry = (props: Props) => {
  function getDeletionDate(isDeletedTimestamp: Date) {
    const date = new Date(isDeletedTimestamp);
    date.setDate(date.getDate() + 30);
    return date.toLocaleDateString();
  }

  return (
    <Card className='mt-6'>
        <div className='bg-white shadow-md rounded-md'>
        <div className='p-4 flex justify-between items-center'>
            <div>
            <h4 className='text-xs italic flex gap-2 items-center'>
              {props.note.noteDate.toString()} - {props.note.noteType}
            </h4>
            <h2 className='text-xl font-bold'>{props.note.authorName}</h2>
            <p className='text-gray-600'>{props.note.noteContentMarkdown.slice(0,15)}</p>
            {props.note.isDeleted && (
              <span className='text-red-500 text-sm font-semibold'>
                Deleted - permanent as of {getDeletionDate(props.note.isDeletedTimestamp)}
              </span>
            )}
            </div>
            <NeoLinkButton 
              route={`/notes/${props.note.id}`}
              label='View'
            />
        </div>
        </div>
    </Card>
  )
}

export default NoteTableEntry