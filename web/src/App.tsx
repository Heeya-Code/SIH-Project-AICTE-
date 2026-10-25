import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Shell, NAV } from './components/Shell';
import { Spinner } from './components/ui';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import { ApplicationList, ApplicationNew } from './pages/Applications';
import ApplicationDetail from './pages/ApplicationDetail';
import Evc from './pages/Evc';
import Compliance from './pages/Compliance';
import Documents from './pages/Documents';
import InboxPage, { AlertsRedirect, EscalationsRedirect, NotificationsRedirect } from './pages/InboxPage';
import Tasks from './pages/Tasks';
import CalendarPage from './pages/CalendarPage';
import Rules from './pages/Rules';
import Verification from './pages/Verification';
import PublicData from './pages/PublicData';
const Analytics = lazy(() => import('./pages/Analytics'));

const Reports = lazy(() => import('./pages/Reports'));
const Audit = lazy(() => import('./pages/Audit'));
const Admin = lazy(() => import('./pages/Admin'));
const WorkflowDesigner = lazy(() => import('./pages/WorkflowDesigner'));

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner label="Restoring your session" />;
  if (!user) return <Routes><Route path="*" element={<Login />} /></Routes>;
  const allowed = (path: string) => NAV.find(n => n.to === path)?.roles.includes(user.role);
  const guard = (path: string, el: JSX.Element) => (allowed(path) ? el : <Navigate to="/" replace />);
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Dashboard />} />
          <Route path="applications" element={<ApplicationList />} />
          <Route path="applications/new" element={user.role === 'institution' ? <ApplicationNew /> : <Navigate to="/applications" replace />} />
          <Route path="applications/:id" element={<ApplicationDetail />} />
          <Route path="evc" element={guard('/evc', <Evc />)} />
          <Route path="compliance" element={guard('/compliance', <Compliance />)} />
          <Route path="documents" element={guard('/documents', <Documents />)} />
          <Route path="calendar" element={guard('/calendar', <CalendarPage />)} />
          <Route path="analytics" element={guard('/analytics', <Analytics />)} />
          <Route path="inbox" element={<InboxPage />} />
          <Route path="alerts" element={<AlertsRedirect />} />
          <Route path="rules" element={<Rules />} />
          <Route path="verification" element={guard('/verification', <Verification />)} />
          <Route path="public-data" element={guard('/public-data', <PublicData />)} />
          <Route path="tasks" element={guard('/tasks', <Tasks />)} />
          <Route path="escalations" element={<EscalationsRedirect />} />
          <Route path="notifications" element={<NotificationsRedirect />} />
          <Route path="reports" element={<Reports />} />
          <Route path="workflows" element={guard('/workflows', <WorkflowDesigner />)} />
          <Route path="audit" element={guard('/audit', <Audit />)} />
          <Route path="admin" element={guard('/admin', <Admin />)} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>);
}
