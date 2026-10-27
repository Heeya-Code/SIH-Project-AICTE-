import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { Button, Spinner } from './ui';

const GROUPS = [['action', 'Action needed'], ['urgent', 'Urgent'], ['update', 'Updates']] as const;

export function NotificationCentre() {
  const nav = useNavigate(); const qc = useQueryClient(); const [open, setOpen] = useState(false); const ref = useRef<HTMLDivElement>(null);
  const count = useQuery({ queryKey: ['unread'], queryFn: () => api<{ unread: number; pending_ack: number }>('/notifications/unread-count'), refetchInterval: 60_000 });
  const list = useQuery({ queryKey: ['notif-centre'], enabled: open, queryFn: () => api<any>('/notifications?pageSize=12') });
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); }; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k); return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, []);
  const unread = count.data?.unread ?? 0; const refresh = () => { qc.invalidateQueries({ queryKey: ['unread'] }); qc.invalidateQueries({ queryKey: ['notif-centre'] }); qc.invalidateQueries({ queryKey: ['notifications'] }); };
  const openItem = async (n: any) => { try { if (!n.read_at) await api(`/notifications/${n.id}/read`, { method: 'POST', body: {} }); } catch { /* navigation still works */ } refresh(); setOpen(false); if (n.link) nav(n.link); };
  return (
    <div ref={ref} className="relative">
      <button aria-label={`Notifications${unread ? `, ${unread > 99 ? '99+' : unread} unread` : ''}`} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(o => !o)} className="relative rounded-md p-2 hover:bg-paper">
        <Bell className="h-5 w-5" aria-hidden />{unread > 0 && <span aria-hidden className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-bad px-1 text-center text-[11px] leading-[18px] text-white">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="Notification centre" className="absolute right-0 top-full z-40 mt-1 w-[min(94vw,400px)] rounded-lg border border-line bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5"><p className="font-semibold">Notifications</p><Button size="sm" variant="ghost" disabled={!unread} onClick={async () => { await api('/notifications/read-all', { method: 'POST', body: {} }); refresh(); }}>Mark all read</Button></div>
          <div className="max-h-[60vh] overflow-y-auto">
            {list.isLoading && <Spinner />}{list.error && <p role="alert" className="p-4 text-bad">Could not load notifications.</p>}
            {list.data && list.data.rows.length === 0 && <p className="p-6 text-center text-muted">You are all caught up.</p>}
            {list.data && GROUPS.map(([k, label]) => { const rows = list.data.rows.filter((n: any) => n.urgency === k); if (!rows.length) return null; return (
              <div key={k} role="group" aria-label={label}><p className="bg-paper px-4 py-1 text-[12px] font-semibold text-muted">{label}</p>
                <ul>{rows.map((n: any) => (
                  <li key={n.id}><button onClick={() => openItem(n)} className={`block w-full border-b border-line/70 px-4 py-2.5 text-left hover:bg-paper ${n.read_at ? '' : 'bg-brand-soft/40'}`}>
                    <span className="flex items-start gap-2">{!n.read_at && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" role="img" aria-label="Unread" />}<span className="min-w-0"><span className="block font-medium">{n.title}</span>{n.related && <span className="block text-[13px] text-muted">{n.related}</span>}<span className="block text-[12px] text-muted">{fmtDateTime(n.created_at)}</span></span></span></button></li>))}</ul></div>); })}
          </div>
          <div className="border-t border-line px-4 py-2.5 text-right"><Link to="/inbox?tab=notifications" onClick={() => setOpen(false)} className="text-brand underline">See all notifications</Link></div>
        </div>)}
    </div>);
}
