import { Button } from '@/components/ui/button'

const NoteTableEntry = () => {
  return (
    <div className='mt-6'>
        <div className='bg-white shadow-md rounded-md'>
        <div className='p-4 flex justify-between items-center'>
            <div>
            <h4 className='text-xs italic'>00/00/0000</h4>
            <h2 className='text-xl font-bold'>Patient ID</h2>
            <p className='text-gray-600'>Chief Complaint + trailing summary...</p>
            </div>
            <div className='mt-4'>
            <Button asChild>
                <a href='/charts/1'>
                View
                </a>
            </Button>
            </div>
        </div>
        </div>
    </div>
  )
}

export default NoteTableEntry