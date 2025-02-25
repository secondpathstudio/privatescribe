import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { BrowserRouter, Route, Routes } from 'react-router'
import App from './pages/Home/Home.tsx'
import Notes from './pages/Notes/Notes.tsx'
import RootLayout from './layouts/root-layout.tsx'
import About from './pages/About/About.tsx'
import NewNote from './pages/Notes/New/NewNote.tsx'
import SignUp from './pages/SignUp/SignUp.tsx'
import Users from './pages/Users/Users.tsx'
import Login from './pages/Login/Login.tsx'
import RequireAuth from './components/auth/RequireAuth.tsx'
import { AuthProvider } from './context/auth-context.tsx'
import SingleNote from './pages/Notes/SingleNote/SingleNote.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
    <BrowserRouter>
      <Routes>
        <Route element={<RootLayout />}>
          <Route path="/" element={<App />} />
          
          <Route path="notes">
            <Route index  element={<RequireAuth><Notes /></RequireAuth>} />
            <Route path=":id" element={<RequireAuth><SingleNote /></RequireAuth>} />
            <Route path="new" element={<RequireAuth><NewNote /></RequireAuth>} />
          </Route>
          
          <Route path="/signup" element={<SignUp />} />
          <Route path="/login" element={<Login />} />
          <Route path="/users" element={<Users />} />
          <Route path="/about" element={<About />} />
        </Route>
      </Routes>
    </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
)
