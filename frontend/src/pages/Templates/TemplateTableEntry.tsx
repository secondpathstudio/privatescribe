import NeoLinkButton from '@/components/neo/neo-link-button';
import { Card } from '@/components/ui/card';

type Props = {
  template: {
    id: number;
    name: string;
    content: string;
    authorId: string;
    version: number;
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
            <h2 className='text-xl font-bold'>{props.template.name}</h2>
            <p className='text-gray-600'>{props.template.content?.slice(0,15)}</p>
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