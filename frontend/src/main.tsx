import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import App from './pages/Home/Home.tsx'
import Notes from './pages/Notes/Notes.tsx'
import RootLayout from './layouts/root-layout.tsx'
import About from './pages/About/About.tsx'
import NewNote from './pages/Notes/New/NewNote.tsx'
import Login from './pages/Login/Login.tsx'
import RequireAuth from './components/auth/RequireAuth.tsx'
import RequireAdmin from './components/auth/RequireAdmin.tsx'
import { AuthProvider } from './context/auth-context.tsx'
import SingleNote from './pages/Notes/SingleNote/SingleNote.tsx'
import Templates from './pages/Templates/Templates.tsx'
import NewTemplate from './pages/Templates/New/NewTemplate.tsx'
import NeobrutalHome from './components/neo/neobrutal-home.tsx'
import SingleTemplate from './pages/Templates/id/SingleTemplate.tsx'
import Roadmap from './pages/Roadmap/Roadmap.tsx'
import Admin from './pages/Admin/Admin.tsx'

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
          
          <Route path="/templates">
            <Route index element={<RequireAuth><Templates /></RequireAuth>} />
            <Route path="new" element={<RequireAuth><NewTemplate /></RequireAuth>} />
            <Route path=":id" element={<RequireAuth><SingleTemplate /></RequireAuth>} />
          </Route>
          <Route path="/admin" element={<RequireAdmin><Admin /></RequireAdmin>} />
          <Route path="/roadmap" element={<Roadmap />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Navigate to="/login" replace />} />
          <Route path="/about" element={<About />} />
        </Route>
      </Routes>
    </BrowserRouter>
    </AuthProvider>
  </StrictMode>
)
