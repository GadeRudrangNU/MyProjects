import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppProvider } from './AppContext'
import { Layout } from './components/Layout'
import { AnalyticsPage } from './pages/Analytics'
import { DashboardPage } from './pages/Dashboard'
import { JobExplorerPage } from './pages/JobExplorer'
import { JobMatchPage } from './pages/JobMatch'
import { ProfilePage } from './pages/Profile'
import { ResumeLabPage } from './pages/ResumeLab'
import { TrackerPage } from './pages/Tracker'
import { WorkspacePage } from './pages/Workspace'
import { EmptyState } from './components/ui'

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<DashboardPage />} />
            <Route path="jobs" element={<JobExplorerPage />} />
            <Route path="jobs/:id" element={<JobMatchPage />} />
            <Route path="jobs/:id/workspace" element={<WorkspacePage />} />
            <Route path="resume-lab" element={<ResumeLabPage />} />
            <Route path="resume-lab/:jobId" element={<ResumeLabPage />} />
            <Route path="tracker" element={<TrackerPage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="*" element={<EmptyState title="Page not found">Use the sidebar to get back on track.</EmptyState>} />
          </Route>
        </Routes>
      </AppProvider>
    </BrowserRouter>
  )
}
