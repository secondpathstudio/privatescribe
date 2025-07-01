import React from 'react'
import PrivateScribeLogo from './private-scribe-logo'

type Props = {}

const NeoFooter = (props: Props) => {
  return (
    <footer className="bg-white py-12 border-b-4 border-black">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-3 gap-8">
            <div>
              <PrivateScribeLogo />
              <p className="text-gray-600">100% private AI transcription.</p>
            </div>
            <div className='flex justify-around items-center'>
                <a href="#features" className="hover:underline">Features</a>
                <a href="#pricing" className="hover:underline">Pricing</a>
                <a href="/roadmap" className="hover:underline">Roadmap</a>
            </div>
          </div>
          <div className="mt-12 pt-6 border-t-4 border-black text-center">
            <p>&copy; {new Date().getFullYear()} <a href="http://www.secondpath.dev">Second Path Studio</a></p>
          </div>
        </div>
      </footer>
  )
}

export default NeoFooter