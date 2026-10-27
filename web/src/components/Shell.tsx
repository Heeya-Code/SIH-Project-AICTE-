import { useState } from 'react';
import { NavLink, Outlet, Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, BarChart3, BellRing, BookOpen, Database, FileCheck2, Inbox, LineChart, Bell, CalendarClock, CalendarDays, FileClock, FileText, GitBranch, LayoutDashboard, ListChecks, LogOut, Menu, ScrollText, Settings, ShieldCheck, X, HelpCircle, ChevronRight } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { useLookups, usePageTitle } from '../lib/hooks';
import { PageMetaProvider, usePageMeta } from '../lib/pagemeta';
import { cx } from './ui';
import { Assistant } from './Assistant';
import { DemoPanel } from './DemoPanel';
import { fmtDate } from '../lib/format';
import { LanguageSwitcher } from '../i18n/LanguageSwitcher';
import { GlobalSearch } from './GlobalSearch';
import { NotificationCentre } from './NotificationCentre';
import { HelpPanel } from './HelpPanel';

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

export const NAV: Item[] = NAV_SECTIONS.flatMap(s => s.items);

const TITLES: Record<string, string> = Object.fromEntries(NAV.map(n => [n.to, n.label]));

function Crumbs() {
  const { pathname } = useLocation(); const { crumb } = usePageMeta();
  const parts: { label: string; to?: string }[] = [];
  const seg = '/' + (pathname.split('/')[1] ?? '');
  if (pathname === '/') parts.push({ label: 'Dashboard' });
  else {
    parts.push({ label: 'Home', to: '/' });
    if (/^\/applications\/new/.test(pathname)) parts.push({ label: 'Applications', to: '/applications' }, { label: 'New application' });
    else if (/^\/applications\/\d+/.test(pathname)) parts.push({ label: 'Applications', to: '/applications' }, { label: crumb ?? 'Case' });
    else parts.push({ label: TITLES[seg] ?? 'Page' });
  }
  usePageTitle(parts[parts.length - 1].label);
  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 md:block"><ol className="flex items-center gap-1 text-sm text-[#475569]">
      {parts.map((p, i) => <li key={i} className="flex items-center gap-1">{i > 0 && <ChevronRight className="h-3.5 w-3.5 text-[#94A3B8]" aria-hidden />}
        {p.to ? <Link to={p.to} className="hover:text-[#0F172A] hover:underline">{p.label}</Link> : <span aria-current="page" className="max-w-[220px] truncate font-semibold text-[#0F172A]">{p.label}</span>}</li>)}
    </ol></nav>);
}

export function Shell() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const lookups = useLookups();
  const location = useLocation();
  const unread = useQuery({ queryKey: ['unread'], queryFn: () => api<{ unread: number; pending_ack: number }>('/notifications/unread-count'), refetchInterval: 60_000 });
  const role = user!.role;
  const clock = lookups.data?.clock;

  const initials = user?.name ? user.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : 'U';

  const navContent = (
    <nav aria-label="Main" className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-3 py-4">
      {NAV_SECTIONS.map(sec => {
        const visible = sec.items.filter(i => i.roles.includes(role));
        if (visible.length === 0) return null;
        return (
          <div key={sec.heading} className="mt-4 first:mt-0">
            <p className="px-3 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8]">{sec.heading}</p>
            <div className="space-y-0.5">
              {visible.map(i => {
                const active = location.pathname === i.to || (i.to !== '/' && location.pathname.startsWith(i.to));
                return (
                  <NavLink key={i.to} to={i.to} end={i.to === '/'} onClick={() => setOpen(false)}
                    className={cx(
                      'relative flex min-h-[40px] items-center gap-3 rounded-lg px-3 py-2 text-[14px] font-medium transition-colors duration-150',
                      active
                        ? 'bg-[#EEF3FF]/15 text-white pl-3.5 border-l-4 border-saffron'
                        : 'text-[#C5D3E6] hover:bg-[#14305F] hover:text-white'
                    )}>
                    <i.icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                    <span className="truncate">{i.label}</span>
                    {i.to === '/inbox' && !!unread.data?.unread && (
                      <span className="ml-auto rounded-full bg-[#2F5BEA] px-2 py-0.5 text-xs text-white" aria-label={`${unread.data.unread} unread`}>{unread.data.unread}</span>
                    )}
                  </NavLink>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );

  return (
    <PageMetaProvider>
    <div className="flex min-h-full bg-[#F5F7FB]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">Skip to content</a>

      {/* Sidebar for Desktop */}
      <aside className="app-sidebar hidden w-64 shrink-0 flex-col text-white lg:sticky lg:top-0 lg:flex lg:h-dvh lg:self-start shadow-sm">
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-5">
          <div className="app-brand-mark flex h-9 w-9 items-center justify-center rounded-xl text-white font-bold text-base shadow-sm">AF</div>
          <div>
            <p className="text-base font-semibold text-white tracking-tight">ApprovalFlow</p>
            <p className="text-[11px] text-[#94A3B8]">AICTE Portal · Prototype</p>
          </div>
        </div>

        {navContent}

        {/* User Card Pinned to Bottom */}
        <div className="shrink-0 border-t border-white/10 p-4 bg-[#0B1B3B]">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#2F5BEA] text-white font-semibold text-sm">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-white truncate">{user!.name}</p>
              <p className="text-[12px] text-[#94A3B8] truncate">{user!.role_label}{user!.region_name ? ` · ${user!.region_name}` : ''}</p>
            </div>
          </div>
          <button onClick={logout} className="flex w-full items-center justify-center gap-2 rounded-[10px] border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-[#C5D3E6] hover:bg-white/10 hover:text-white transition-colors">
            <LogOut className="h-4 w-4" aria-hidden /> Sign out
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {open && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="flex h-dvh w-72 flex-col bg-[#0B1B3B] text-white shadow-xl">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#2F5BEA] text-white font-bold text-sm">AF</div>
                <p className="text-base font-semibold text-white">ApprovalFlow</p>
              </div>
              <button aria-label="Close menu" className="rounded-md p-1.5 text-[#94A3B8] hover:bg-white/10 hover:text-white" onClick={() => setOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            {navContent}
            <div className="shrink-0 border-t border-white/10 p-4">
              <button onClick={logout} className="flex w-full items-center justify-center gap-2 rounded-[10px] border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-[#C5D3E6] hover:bg-white/10 hover:text-white">
                <LogOut className="h-4 w-4" aria-hidden /> Sign out
              </button>
            </div>
          </div>
          <button aria-label="Close menu" className="flex-1 bg-black/50 backdrop-blur-xs" onClick={() => setOpen(false)} />
        </div>
      )}

      {/* Main Content Pane */}
      <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden">
        {/* Top bar (64px, white, bottom border) */}
        <header className="app-topbar sticky top-0 z-30 flex h-16 items-center justify-between border-b border-[#E2E8F0] bg-white px-4 sm:px-8 shadow-xs">
          <div className="flex items-center gap-3">
            <button className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-[#E2E8F0] text-[#475569] hover:bg-[#F5F7FB] lg:hidden" aria-label="Open menu" onClick={() => setOpen(o => !o)}>
              <Menu className="h-5 w-5" />
            </button>
            <Crumbs />
          </div>

          <div className="mx-4 hidden min-w-0 flex-1 justify-center sm:flex"><GlobalSearch /></div>
          <div className="flex items-center gap-3 sm:gap-4">
            {clock?.simulated && (
              <div role="status" className="hidden md:flex items-center gap-1.5 rounded-full bg-[#FFF4DB] px-3 py-1 text-xs font-medium text-[#B45309] border border-[#F59E0B]/30">
                <span className="h-1.5 w-1.5 rounded-full bg-[#F59E0B] animate-pulse" />
                Simulated: {fmtDate(clock.today)}
              </div>
            )}

            <button aria-label="Help" onClick={() => setHelp(true)} className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-[#E2E8F0] bg-white text-[#475569] hover:bg-[#F5F7FB] hover:text-[#0F172A]"><HelpCircle className="h-5 w-5" aria-hidden /></button>
            <NotificationCentre />

            <LanguageSwitcher />

            <div title={`${user!.name}, ${user!.role_label}`} className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0B1B3B] text-xs font-semibold text-white lg:hidden"><span aria-hidden>{initials}</span><span className="sr-only">{user!.name}, {user!.role_label}</span></div>
          </div>
        </header>

        <div className="border-b border-[#E2E8F0] bg-white px-4 py-2 sm:hidden"><GlobalSearch /></div>

        {clock?.simulated && (
          <div role="status" className="flex md:hidden items-center justify-center gap-2 bg-[#FFF4DB] px-4 py-2 text-xs font-medium text-[#B45309] border-b border-[#F59E0B]/30">
            <span className="h-1.5 w-1.5 rounded-full bg-[#F59E0B]" />
            Simulated date: {fmtDate(clock.today)}
          </div>
        )}

        {/* Content area */}
        <main id="main" className="mx-auto w-full max-w-[1320px] flex-1 overflow-x-hidden p-6 sm:p-8">
          <Outlet />
        </main>
      </div>

      <Assistant />
      <DemoPanel />
      {help && <HelpPanel onClose={() => setHelp(false)} />}
    </div>
    </PageMetaProvider>
  );
}
