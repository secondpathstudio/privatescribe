import { Breadcrumbs } from '@/components/ui/breadcrumb'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import NewTemplateForm from './NewTemplateForm';

const NewTemplate = () => {

  return (
    <div className="max-w-screen-lg mx-auto px-4 py-10">
        <Breadcrumbs 
          notes={[
            {
              label: "All Templates",
              href: '/templates',
            },
            {
              label: "New Template",
            },
          ]}
          />
        <h1 className='text-4xl font-bold mt-6'>Create Template</h1>
        <Card className='mt-5'>
          <CardHeader>
            <CardTitle>
              <NewTemplateForm />
            </CardTitle>
          </CardHeader>
        </Card>
    </div>
  )
}

export default NewTemplate