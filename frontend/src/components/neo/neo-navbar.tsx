import PrivateScribeLogo from './private-scribe-logo'
import AuthButtons from '../auth-buttons'
import { Link, useLocation } from 'react-router'
import NeoAnchorButton from './neo-a-button'
import { GithubIcon } from 'lucide-react'
import { useAuth } from '@/context/auth-context'

type Props = {}

const NeoNavbar = (props: Props) => {
  const location = useLocation();
  const auth = useAuth();

  // Show the auth menu (Account / Admin / Logout) in any app context: the
  // desktop app, local dev, OR whenever someone is logged in — which now
  // includes phones/laptops hitting a LAN server in the browser. The only
  // place it must stay hidden is the public marketing site (privatescribe.ai),
  // which never has a session, so gating on a live user keeps it off there
  // while making logout reachable for every real client.
  const showAuthMenu =
    !!window.electron ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    !!auth.user;

  return (
    <nav className="bg-white border-b-4 border-black p-4 md:px-6">
        <div className="container mx-auto flex justify-between items-center">
          <div className="font-black text-3xl">
            {/* <Link>, not <a href>: the desktop app runs under HashRouter
                (file:// URLs), where a plain anchor lands on a blank page. */}
            <Link to="/">
              <PrivateScribeLogo />
            </Link>
          </div>
          {location.pathname === '/' && (
            <div className="hidden md:flex space-x-6">
              <a href="#features" className="font-black hover:text-[#fd3777]">Features</a>
              <a href="#pricing" className="font-black hover:text-[#fd3777]">Pricing</a>
              <a href="#faq" className="font-black hover:text-[#fd3777]">FAQ</a>
              <Link to="/roadmap" className="font-black hover:text-[#fd3777]">Roadmap</Link>
            </div>
          )}
          {showAuthMenu && <AuthButtons />}
        </div>
      </nav>
  )
}

export default NeoNavbar