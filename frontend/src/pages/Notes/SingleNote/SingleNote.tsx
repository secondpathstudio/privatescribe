import { Breadcrumbs } from '@/components/ui/breadcrumb'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { useParams } from 'react-router'
import { useEffect, useState } from 'react'
import { useAuth } from '@/context/auth-context'

const SingleNote = () => {
    const auth = useAuth();
    const { id } = useParams()
    const [note, setNote] = useState(null)

    useEffect(() => {
        fetch(`http://127.0.0.1:5000/api/notes/${id}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${auth.token}`,
            },
        })
        .then(response => response.json())
        .then(data => {
            setNote(data)
        })
        .catch(error => {
            console.error("Error:", error)
            alert("Note not found")
        })
    }, [id])


  return (
    <div className="max-w-screen-lg mx-auto px-4 py-10">
        <Breadcrumbs 
          notes={[
            {
              label: "All Notes",
              href: '/notes',
            },
            {
              label: `Note ${id}`,
            },
          ]}
          />
        <Card className='mt-5'>
          <CardHeader>
            <CardTitle>
              Note ID: {id}
            </CardTitle>
          </CardHeader>
        </Card>
    </div>
  )
}

export default SingleNote