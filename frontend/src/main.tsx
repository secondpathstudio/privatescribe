import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { BrowserRouter, Route, Routes } from 'react-router'
import App from './pages/Home/Home.tsx'
import Notes from './pages/Notes/Notes.tsx'
import RootLayout from './layouts/root-layout.tsx'
import About from './pages/About/About.tsx'
import NewNote from './pages/Notes/New/NewNote.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<RootLayout />}>
          <Route path="/" element={<App />} />
          
          <Route path="notes">
            <Route index  element={<Notes />} />
            <Route path="new" element={<NewNote />} />
          </Route>
          
          <Route path="/about" element={<About />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
