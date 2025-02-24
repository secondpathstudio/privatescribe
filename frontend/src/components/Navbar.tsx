import AuthButtons from '@/components/auth-buttons'

const Navbar = () => {
  return (
    <nav className="flex items-center justify-between bg-black text-white p-5 h-20">
        <a href="/" className='flex items-center space-x-2'>
            <img src="/pirate-logo.png" alt="PirateScribe.ai" className="h-10 w-10" />
            <h1 className="text-3xl font-bold">PirateScribe.ai</h1>
        </a>
        <div className='flex items-center space-x-5'>
            <AuthButtons />
        </div>
    </nav>
  )
}

export default Navbar