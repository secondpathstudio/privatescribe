import { Breadcrumbs } from '@/components/ui/breadcrumb'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { useEffect, useState } from 'react'
import SingleTemplateForm from './SingleTemplateForm'
import { useParams } from 'react-router'
import { useAuth } from '@/context/auth-context'



const SingleTemplate = () => {
  const [template, setTemplate] = useState<any>(null)
  const { id } = useParams()
  const auth = useAuth();

  useEffect(() => {
    const fetchTemplate = async () => {
      console.log('fetching template', id)
      try {
        const response = await fetch(`http://127.0.0.1:5000/api/templates/${id}`, {
          method: 'GET',
          headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auth.token}`,
          },
      });
        const data = await response.json()
        console.log('received template data', data)
        setTemplate(data)
      }
      catch (error) {
        console.error(error)
      }
    }

    fetchTemplate()
  }, [id])


  return (
    <div className="max-w-screen-lg mx-auto px-4 py-10">
        <Breadcrumbs 
          notes={[
            {
              label: "All Templates",
              href: '/templates',
            },
            {
              label: `Template ${id}`,
            },
          ]}
          />
        <h1 className='text-4xl font-black mt-6'>Template {template?.id}</h1>
        <Card className='mt-5'>
          <CardHeader>
            <CardTitle>
              {template && 
              <SingleTemplateForm note={template} />
              }
            </CardTitle>
          </CardHeader>
        </Card>
    </div>
  )
}

export default SingleTemplate