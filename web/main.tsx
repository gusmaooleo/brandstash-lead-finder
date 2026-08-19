import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import App from './App'
import { LeadPage } from './components/LeadPage'
import { TablePage } from './components/TablePage'
import { AnalyticsPage } from './components/AnalyticsPage'
import { SettingsPage } from './components/SettingsPage'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/table" element={<TablePage />} />
        <Route path="/email-analytics" element={<AnalyticsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/leads/:id" element={<LeadPage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
