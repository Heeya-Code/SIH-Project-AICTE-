import { CheckCircle2, Circle, AlertCircle } from 'lucide-react';

export function StageStepper({ stages, currentStageKey, status, stageDueDate }: { stages: any[]; currentStageKey: string | null; status: string; stageDueDate?: string | null }) {
  if (!stages || stages.length === 0) return null;

  const currentIndex = stages.findIndex(s => s.key === currentStageKey);

  return (
    <div className="mb-4 rounded-lg border border-line bg-white p-4 shadow-sm">
      <p className="mb-3 text-[13px] font-medium text-muted uppercase tracking-wider">Workflow progress</p>
      <ol className="flex flex-wrap gap-2" aria-label="Application stages">
        {stages.map((s, idx) => {
          let state: 'completed' | 'current' | 'upcoming' | 'returned' = 'upcoming';
          if (status === 'approved') {
            state = 'completed';
          } else if (['rejected', 'withdrawn'].includes(status)) {
            state = currentIndex >= 0 && idx <= currentIndex ? 'completed' : 'upcoming';
          } else if (status === 'draft') {
            state = 'upcoming';
          } else {
            if (currentIndex >= 0) {
              if (idx < currentIndex) state = 'completed';
              else if (idx === currentIndex) {
                state = status === 'returned' ? 'returned' : 'current';
              } else {
                state = 'upcoming';
              }
            } else {
              state = 'upcoming';
            }
          }

          const isCurrent = state === 'current' || state === 'returned';

          return (
            <li key={s.key} className={`flex min-w-[135px] max-w-full flex-1 items-center gap-2.5 rounded-md border p-2.5 text-left ${isCurrent ? 'border-brand bg-brand-soft/20 shadow-xs' : 'border-line/70 bg-paper/50'}`} aria-current={isCurrent ? 'step' : undefined}>
              <div className="shrink-0">
                {state === 'completed' && <CheckCircle2 className="h-5 w-5 text-good" aria-hidden />}
                {state === 'current' && <Circle className="h-5 w-5 fill-brand text-brand" aria-hidden />}
                {state === 'returned' && <AlertCircle className="h-5 w-5 text-warn" aria-hidden />}
                {state === 'upcoming' && <Circle className="h-5 w-5 text-muted/40" aria-hidden />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{s.name}</p>
                <p className="text-[11px] text-muted truncate">
                  {state === 'completed' ? 'Completed' : state === 'current' ? (stageDueDate ? `Due ${stageDueDate}` : 'Current stage') : state === 'returned' ? 'Needs response' : 'Upcoming'}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
