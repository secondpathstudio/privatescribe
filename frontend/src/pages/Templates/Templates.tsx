import { Breadcrumbs } from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
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

      <h1 className='text-4xl font-bold mt-6'>All Templates</h1>
      <Button asChild className='inline-flex pl-2 gap-2 mt-4'>
        <Link to='/templates/new'>
          📝 Create Template
        </Link>
      </Button>
        
      <div>
        Templates
      </div>
    </div>
  )
}

export default Templates