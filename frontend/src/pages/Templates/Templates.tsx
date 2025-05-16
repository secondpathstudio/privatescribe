import NeoLinkButton from '@/components/neo/neo-link-button'
import { Breadcrumbs } from '@/components/ui/breadcrumb'
import { useAuth } from '@/context/auth-context';
import { useEffect, useState } from 'react';
import TemplateTableEntry from './TemplateTableEntry';

const Templates = () => {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const auth = useAuth();

  useEffect(() => {
    const fetchTemplates = async () => {
      setLoading(true);
      try {
        const response = await fetch(`http://127.0.0.1:5000/api/templates/user/${auth.user?.id}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${auth.token}`,
          },
        });

        if (!response.ok) {
          console.log('Invalid server response: ', response)
          throw new Error('Network request failed with status ' + response.status);
        } else {
          const data = await response.json();
          console.log("Received data: ", data);
          setTemplates(data);
        }
      } catch (error) {
        console.log('Error fetching templates: ', error)
      }
      setLoading(false);
    }

    fetchTemplates();
  }, []);
  
  

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
        <h1 className='text-4xl font-black mt-6'>All Templates</h1>
        <NeoLinkButton 
          route='/templates/new' 
          label='📝 Create Template'
          backgroundColor='#fd3777' 
          textColor='#ffffff' />
      </div>
        
      <div>
        {loading && <p>Loading...</p>}
        {templates.length === 0 && !loading && <p>No templates found.</p>}
        {templates.length > 0 && templates.map((template: any) => (
          <TemplateTableEntry key={template.id} template={template} />
        ))}
      </div>
    </div>
  )
}

export default Templates