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
            <div>
              <h4 className="font-black text-lg mb-4">PRODUCT</h4>
              <ul className="space-y-2">
                <li><a href="#features" className="hover:underline">Features</a></li>
                <li><a href="#pricing" className="hover:underline">Pricing</a></li>
                <li><a href="#" className="hover:underline">Roadmap</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-black text-lg mb-4">CONNECT</h4>
              <ul className="space-y-2">
                <li><a href="#" className="hover:underline">Twitter</a></li>
                <li><a href="#" className="hover:underline">Instagram</a></li>
                <li><a href="#" className="hover:underline">GitHub</a></li>
              </ul>
            </div>
          </div>
          <div className="mt-12 pt-6 border-t-4 border-black text-center">
            <p>&copy; {new Date().getFullYear()} Second Path Studio. All rights reserved.</p>
          </div>
        </div>
      </footer>
  )
}

export default NeoFooter