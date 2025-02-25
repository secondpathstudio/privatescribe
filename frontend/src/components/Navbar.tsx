import AuthButtons from '@/components/auth-buttons'
import { useAuth } from '@/context/auth-context'
import { Link } from 'react-router';

const Navbar = () => {
  const auth = useAuth();

  return (
    <nav className="flex items-center justify-between bg-black text-white p-5 h-20">
        <Link to="/" className='flex items-center space-x-2'>
            <img src="/pirate-logo.png" alt="PirateScribe.ai" className="h-10 w-10" />
            <h1 className="text-3xl font-bold">PirateScribe.ai</h1>
        </Link>
        <div className='flex items-center space-x-5'>
            {auth.user ? <AuthButtons /> : <Link to="/login">Login</Link>}
        </div>
    </nav>
  )
}

export default Navbar