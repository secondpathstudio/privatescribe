import NeoLinkButton from '@/components/neo/neo-link-button';
import { Card } from '@/components/ui/card';
import { Trash2 } from 'lucide-react';
import Markdown from 'react-markdown'

type Props = {
  template: {
    id: number;
    name: string;
    content: string;
    authorId: string;
    version: number;
    isDeleted: boolean;
  }
}

const TemplateTableEntry = (props: Props) => {
  return (
    <Card className='mt-6'>
        <div className='bg-white shadow-md rounded-md'>
        <div className='p-4 flex justify-between items-center'>
            <div>
            <h4 className='text-xs italic flex gap-2 items-center'>
              ver. {props.template.version}
            </h4>
            <h2 className='flex gap-2 text-xl font-bold'>{props.template.name} {props.template.isDeleted && <Trash2 />}</h2>
            <p className='text-gray-600'>
              <Markdown>{props.template.content?.slice(0,15)}</Markdown>
            </p>
            </div>
            <NeoLinkButton 
              route={`/templates/${props.template.id}`}
              label='View'
            />
        </div>
        </div>
    </Card>
  )
}

export default TemplateTableEntry