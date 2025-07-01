import PrivateScribeLogo from './private-scribe-logo'
import AuthButtons from '../auth-buttons'
import { useLocation } from 'react-router'
import NeoAnchorButton from './neo-a-button'
import { GithubIcon } from 'lucide-react'

type Props = {}

const NeoNavbar = (props: Props) => {
  const location = useLocation();
  
  return (
    <nav className="bg-white border-b-4 border-black p-4 md:px-6">
        <div className="container mx-auto flex justify-between items-center">
          <div className="font-black text-3xl">
            <a href="/">
              <PrivateScribeLogo />
            </a>
          </div>
          {location.pathname === '/' && (
            <div className="hidden md:flex space-x-6">
              <a href="#features" className="font-black hover:text-[#fd3777]">Features</a>
              <a href="#pricing" className="font-black hover:text-[#fd3777]">Pricing</a>
              <a href="#faq" className="font-black hover:text-[#fd3777]">FAQ</a>
              <a href="/roadmap" className="font-black hover:text-[#fd3777]">Roadmap</a>
            </div>
          )}
          {(window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") ?
          <AuthButtons />
          :
          <NeoAnchorButton href="http://www.github.com" backgroundColor='#ffffff' textColor="#000000">
            <GithubIcon />
          </NeoAnchorButton>
          }
        </div>
      </nav>
  )
}

export default NeoNavbar