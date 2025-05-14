import NeoLinkButton from '@/components/neo/neo-link-button'
import { Breadcrumbs } from '@/components/ui/breadcrumb'
import { Link } from 'react-router'

const Templates = () => {
  return (
    <div className="max-w-screen-lg mx-auto px-4 py-10">
      <Breadcrumbs 
        notes={[
          {
            label: "All Templates",
          },
        ]}
      />

      <div className='flex justify-between items-center'>
        <h1 className='text-4xl font-bold mt-6'>All Templates</h1>
        <NeoLinkButton 
          route='/templates/new' 
          label='📝 Create Template'
          backgroundColor='#fd3777' 
          textColor='#ffffff' />
      </div>
        
      <div>
        Templates
      </div>
    </div>
  )
}

export default Templates