import { useSearchParams, Navigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Notifications, Escalations } from './Inbox';
import Alerts from './Alerts';
import { PageHeader, Tabs } from '../components/ui';

const ESCALATION_ROLES = ['regional_officer', 'bureau_officer', 'evc_coordinator', 'competent_authority', 'admin'];
const TABS = [
  { key: 'alerts', label: 'Alerts' },
  { key: 'escalations', label: 'Escalations' },
  { key: 'notifications', label: 'Notifications' },
];

export default function InboxPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const canEscalations = ESCALATION_ROLES.includes(user!.role);
  const tabs = canEscalations ? TABS : TABS.filter(t => t.key !== 'escalations');
  const raw = params.get('tab') ?? 'alerts';
  const tab = tabs.find(t => t.key === raw) ? raw : 'alerts';
  const setTab = (t: string) => setParams({ tab: t }, { replace: true });
  return (
    <>
      <PageHeader title="Inbox" subtitle="Alerts, escalations and notifications in one place." />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      <div className="mt-4">
        {tab === 'alerts' && <AlertsEmbed />}
        {tab === 'escalations' && canEscalations && <Escalations />}
        {tab === 'notifications' && <Notifications />}
      </div>
    </>);
}

/** Alerts without its own PageHeader — the Inbox provides it. */
function AlertsEmbed() { return <Alerts embedded />; }

/** Redirect helpers for legacy routes. */
export const AlertsRedirect = () => <Navigate to="/inbox?tab=alerts" replace />;
export const EscalationsRedirect = () => {
  const { user } = useAuth();
  if (!ESCALATION_ROLES.includes(user!.role)) return <Navigate to="/" replace />;
  return <Navigate to="/inbox?tab=escalations" replace />;
};
export const NotificationsRedirect = () => <Navigate to="/inbox?tab=notifications" replace />;
