import { Button } from '@/components/ui/button'
import { Github } from 'lucide-react'

const About = () => {
  return (
    <div className='w-full h-screen gap-4 flex flex-col items-center justify-center'>
      <p>
        A simple AI-enhanced dictation app built by doctors for doctors.
      </p>
      <p>
        <span className='font-bold'>Frontend:</span> Vite+React, TailwindCSS, TypeScript
      </p>
      <p>
      <span className='font-bold'>Backend:</span> Flask, SQLite, SQLAlchemy
      </p>
      <Button asChild className='inline-flex pl-2 gap-2 mt-4'>
        <a href="http://www.github.com" rel='noreferrer noopener' target='_blank'>
          <Github />
          <span>View on GitHub</span>
        </a>
      </Button>
    </div>
  )
}

export default About