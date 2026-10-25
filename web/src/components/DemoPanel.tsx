import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, Play, ChevronUp, ChevronDown } from 'lucide-react';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLookups } from '../lib/hooks';
import { Button, useToast } from './ui';
import { fmtDate } from '../lib/format';

export function DemoPanel() {
  const { user } = useAuth();
  const lookups = useLookups();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [jobResult, setJobResult] = useState<string | null>(null);

  const sys = useQuery({ queryKey: ['system'], queryFn: () => api<any>('/admin/system') });

  if (user?.role !== 'admin' || !sys.data?.demo_tools) return null;

  const clock = lookups.data?.clock;

  const clockMutation = useMutation({
    mutationFn: (body: any) => api('/admin/clock', { body }),
    onSuccess: () => {
      qc.invalidateQueries();
      toast.ok('Clock updated');
    },
    onError: e => toast.err(errMsg(e)),
  });

  const jobsMutation = useMutation({
    mutationFn: () => api<any>('/admin/jobs/run', { method: 'POST', body: {} }),
    onSuccess: (res: any) => {
      qc.invalidateQueries();
      const summary = res.summary || {};
      const parts = Object.entries(summary).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
      setJobResult(parts.length ? parts.join(', ') : 'Jobs completed successfully');
      toast.ok('Jobs ran successfully');
    },
    onError: e => toast.err(errMsg(e)),
  });

  return (
    <div className="fixed bottom-3 left-3 z-50">
      <div className="rounded-lg border border-line bg-ink text-white shadow-lg">
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-2 px-3 py-2 text-[13px] font-medium hover:bg-white/10 rounded-lg w-full text-left"
          aria-expanded={open}
        >
          <Clock className="h-4 w-4 text-brand shrink-0" />
          <span className="truncate">Demo clock: {clock?.simulated ? fmtDate(clock.today) : 'Real time'}</span>
          {open ? <ChevronDown className="ml-auto h-4 w-4 shrink-0" /> : <ChevronUp className="ml-auto h-4 w-4 shrink-0" />}
        </button>
        {open && (
          <div className="border-t border-white/10 p-3 space-y-3 text-[13px] bg-ink w-72">
            <p className="text-[#9fb3cc]">Simulated date: {clock?.today || 'Today'}</p>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="secondary" onClick={() => clockMutation.mutate({ advance_days: 1 })}>+1 day</Button>
              <Button size="sm" variant="secondary" onClick={() => clockMutation.mutate({ advance_days: 7 })}>+7 days</Button>
              <Button size="sm" variant="secondary" onClick={() => clockMutation.mutate({ advance_days: 30 })}>+30 days</Button>
              <Button size="sm" variant="secondary" onClick={() => clockMutation.mutate({ date: null })}>Use real date</Button>
            </div>
            <div>
              <Button size="sm" variant="primary" className="w-full justify-center" busy={jobsMutation.isPending} onClick={() => jobsMutation.mutate()}>
                <Play className="h-3.5 w-3.5 mr-1" /> Run jobs now
              </Button>
            </div>
            {jobResult && (
              <div className="rounded bg-white/10 p-2 text-[11px] text-[#c5d3e6] break-all">
                Result: {jobResult}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
