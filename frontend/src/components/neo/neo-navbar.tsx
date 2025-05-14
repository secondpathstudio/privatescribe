import PrivateScribeLogo from './private-scribe-logo'
import AuthButtons from '../auth-buttons'
import { useLocation } from 'react-router'

type Props = {}

const NeoNavbar = (props: Props) => {
  const location = useLocation();
  
  return (
    <nav className="bg-white border-b-4 border-black p-4 px-6">
        <div className="container mx-auto flex justify-between items-center">
          <div className="font-black text-3xl">
            <a href="/">
              {/* Private<span style={{color: "#fd3777"}}>Scribe</span> */}
              <PrivateScribeLogo />
            </a>
          </div>
          {location.pathname === '/' && (
            <div className="hidden md:flex space-x-6">
              <a href="#features" className="font-bold hover:underline">Features</a>
              <a href="#pricing" className="font-bold hover:underline">Pricing</a>
              <a href="#faq" className="font-bold hover:underline">FAQ</a>
            </div>
          )}
          <AuthButtons />
        </div>
      </nav>
  )
}

export default NeoNavbar