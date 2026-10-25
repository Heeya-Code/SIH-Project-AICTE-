import { useState } from 'react';
import { NavLink, Outlet, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, BarChart3, BellRing, BookOpen, Database, FileCheck2, Inbox, LineChart, Bell, CalendarClock, CalendarDays, FileClock, FileText, GitBranch, LayoutDashboard, ListChecks, LogOut, Menu, ScrollText, Settings, ShieldCheck, X } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { useLookups } from '../lib/hooks';
import { cx } from './ui';
import { Assistant } from './Assistant';
import { DemoPanel } from './DemoPanel';
import { fmtDate } from '../lib/format';

type Item = { to: string; label: string; icon: any; roles: string[] };
const ALL = ['institution', 'regional_officer', 'bureau_officer', 'evc_coordinator', 'competent_authority', 'admin'];
type Section = { heading: string; items: Item[] };
export const NAV_SECTIONS: Section[] = [
  { heading: 'Work', items: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, roles: ALL },
    { to: '/applications', label: 'Applications', icon: FileText, roles: ALL },
    { to: '/evc', label: 'EVC scheduling', icon: CalendarClock, roles: ['regional_officer', 'bureau_officer', 'evc_coordinator'] },
    { to: '/tasks', label: 'Tasks and pendency', icon: ListChecks, roles: ['regional_officer', 'bureau_officer', 'evc_coordinator', 'competent_authority', 'institution'] },
    { to: '/calendar', label: 'Calendar', icon: CalendarDays, roles: ['institution', 'regional_officer', 'bureau_officer', 'evc_coordinator'] },
    { to: '/inbox', label: 'Inbox', icon: Inbox, roles: ALL },
  ]},
  { heading: 'Compliance', items: [
    { to: '/compliance', label: 'Compliance tracker', icon: ShieldCheck, roles: ['institution', 'regional_officer', 'bureau_officer', 'competent_authority'] },
    { to: '/documents', label: 'Document validity', icon: FileClock, roles: ['institution', 'regional_officer', 'bureau_officer'] },
    { to: '/verification', label: 'Document verification', icon: FileCheck2, roles: ['regional_officer', 'bureau_officer'] },
  ]},
  { heading: 'Insights', items: [
    { to: '/analytics', label: 'Analytics', icon: LineChart, roles: ['regional_officer', 'bureau_officer', 'evc_coordinator', 'competent_authority', 'admin'] },
    { to: '/reports', label: 'Reports and analytics', icon: BarChart3, roles: ALL },
    { to: '/alerts', label: 'Alerts', icon: BellRing, roles: ALL },
  ]},
  { heading: 'Configure', items: [
    { to: '/workflows', label: 'Workflow designer', icon: GitBranch, roles: ['admin', 'bureau_officer'] },
    { to: '/rules', label: 'Regulatory rules', icon: BookOpen, roles: ALL },
    { to: '/public-data', label: 'Public data', icon: Database, roles: ['admin', 'bureau_officer', 'regional_officer', 'competent_authority'] },
    { to: '/audit', label: 'Audit trail', icon: ScrollText, roles: ['admin', 'bureau_officer', 'competent_authority'] },
    { to: '/admin', label: 'Administration', icon: Settings, roles: ['admin'] },
  ]},
];
/** Flat list used by App.tsx for route guarding. */
export const NAV: Item[] = NAV_SECTIONS.flatMap(s => s.items);

export function Shell() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const lookups = useLookups();
  const unread = useQuery({ queryKey: ['unread'], queryFn: () => api<{ unread: number; pending_ack: number }>('/notifications/unread-count'), refetchInterval: 60_000 });
  const role = user!.role;
  const clock = lookups.data?.clock;
  const nav = (
    <nav aria-label="Main" className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-2 py-3">
      {NAV_SECTIONS.map(sec => {
        const visible = sec.items.filter(i => i.roles.includes(role));
        if (visible.length === 0) return null;
        return (<div key={sec.heading} className="mt-3 first:mt-0">
          <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-[#8da2b9]">{sec.heading}</p>
          {visible.map(i => (
            <NavLink key={i.to} to={i.to} end={i.to === '/'} onClick={() => setOpen(false)}
              className={({ isActive }) => cx('flex items-center gap-2.5 rounded-md px-3 py-2 text-[14px]', isActive ? 'bg-white/14 font-medium text-white' : 'text-[#c5d3e6] hover:bg-white/8 hover:text-white')}>
              <i.icon className="h-4 w-4 shrink-0" aria-hidden />{i.label}
              {i.to === '/inbox' && !!unread.data?.unread && <span className="ml-auto rounded-full bg-teal px-1.5 text-xs text-white" aria-label={`${unread.data.unread} unread`}>{unread.data.unread}</span>}
            </NavLink>))}
        </div>);
      })}
    </nav>);
  return (
    <div className="flex min-h-full">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
      <aside className="hidden w-60 shrink-0 flex-col bg-ink lg:sticky lg:top-0 lg:flex lg:h-dvh lg:self-start">
        <div className="shrink-0 border-b border-white/10 px-4 py-4"><p className="text-[17px] font-semibold text-white">ApprovalFlow</p><p className="text-[12px] text-[#9fb3cc]">Demonstration prototype</p></div>
        {nav}
        <div className="shrink-0 border-t border-white/10 p-3 text-[12px] text-[#9fb3cc]">Synthetic data only. Not connected to any AICTE system.</div>
      </aside>
      {open && (<div className="fixed inset-0 z-40 flex lg:hidden"><div className="flex h-dvh w-64 flex-col bg-ink">{nav}</div><button aria-label="Close menu" className="flex-1 bg-ink/50" onClick={() => setOpen(false)} /></div>)}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line bg-white px-4 py-2.5">
          <button className="rounded p-1.5 hover:bg-paper lg:hidden" aria-label="Open menu" onClick={() => setOpen(o => !o)}>{open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
          <p className="hidden text-muted sm:block">One platform. Every workflow. Every deadline. Complete accountability.</p>
          <div className="ml-auto flex items-center gap-3">
            <Link to="/inbox?tab=notifications" className="relative rounded p-1.5 hover:bg-paper" aria-label={`Notifications${unread.data?.unread ? `, ${unread.data.unread} unread` : ''}`}>
              <Bell className="h-5 w-5" />{!!unread.data?.unread && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-bad px-1 text-[10px] leading-4 text-white">{unread.data.unread}</span>}</Link>
            <div className="hidden text-right leading-tight sm:block"><p className="font-medium">{user!.name}</p><p className="text-[12px] text-muted">{user!.role_label}{user!.region_name ? `, ${user!.region_name}` : ''}</p></div>
            <button onClick={logout} aria-label="Sign out" className="flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 hover:bg-paper"><LogOut className="h-4 w-4" aria-hidden /><span className="hidden sm:inline">Sign out</span></button>
          </div>
        </header>
        {clock?.simulated && <div role="status" className="bg-warn-soft px-4 py-1.5 text-[13px] text-warn">Demo clock is set to {fmtDate(clock.today)}. Deadlines and reminders follow this simulated date.</div>}
        <main id="main" className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-6 sm:px-6"><Outlet /></main>
      </div>
      <Assistant />
      <DemoPanel />
    </div>);
}
