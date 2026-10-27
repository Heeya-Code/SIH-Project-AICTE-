import { useLocation } from 'react-router-dom';
import { APP_STATUS } from '../lib/format';
import { Badge, Modal, Button } from './ui';

const PAGE_HELP: [RegExp, string, string][] = [
  [/^\/$/, 'Dashboard', 'The list at the top shows what needs you first, ranked by urgency, with the reason for each item. The figures below are counts from the live records; click one to open the matching cases.'],
  [/^\/applications\/new/, 'New application', 'Pick the category, give it a title and save the draft. You then upload the required documents and review before anything is sent.'],
  [/^\/applications\/\d+/, 'A case', 'The strip at the top says which stage the case is in, who has it and what happens next. Use the tabs for documents, deficiencies, the timeline, notifications and the audit history.'],
  [/^\/applications/, 'Applications', 'Search by reference, title or institution, then narrow with filters. Save a filter you use often as a preset.'],
  [/^\/verification/, 'Document verification', 'Documents are listed oldest first. Verify a document, or return it with a reason the institution can act on.'],
  [/^\/evc/, 'EVC scheduling', 'Queued cases need a date and a committee. Suggested slots avoid clashes. After the visit, record it to move the case on.'],
  [/^\/compliance/, 'Compliance', 'An upload alone never verifies an obligation. A reviewer must verify or return it.'],
  [/^\/documents/, 'Document validity', 'Shows each current document with its expiry. A renewal is saved as a new version; earlier versions are kept.'],
  [/^\/analytics/, 'Analytics', 'Every figure is calculated from the records and labelled. Click a bar or card to see the cases behind it.'],
  [/^\/public-data/, 'Public data', 'Imports come from files you download yourself. A source needs a recorded licence first. Conflicts wait for a person to decide.'],
  [/^\/rules/, 'Regulatory rules', 'Shows what each rule rests on and how well it is verified. Only rules checked against the official text can be activated.'],
];

export function HelpPanel({ onClose }: { onClose: () => void }) {
  const { pathname } = useLocation(); const page = PAGE_HELP.find(([re]) => re.test(pathname));
  return (
    <Modal title="Help" onClose={onClose} wide footer={<Button variant="primary" onClick={onClose}>Close</Button>}>
      {page && <section><h3 className="font-semibold">On this page: {page[1]}</h3><p className="text-muted">{page[2]}</p></section>}
      <section><h3 className="mb-1 font-semibold">What the statuses mean</h3>
        <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">{([['draft', 'Saved but not sent. Nobody at AICTE can see it yet.'], ['in_progress', 'Submitted and being worked on at its current stage.'], ['returned', 'Sent back to the institution. It will not move until the institution responds.'], ['approved', 'A decision was recorded by the competent authority.'], ['rejected', 'A rejection was recorded with a reason.'], ['withdrawn', 'Withdrawn by the institution.']] as const).map(([k, t]) => <div key={k}><dt><Badge tone={APP_STATUS[k].tone}>{APP_STATUS[k].label}</Badge></dt><dd className="text-[13px] text-muted">{t}</dd></div>)}</dl></section>
      <section><h3 className="mb-1 font-semibold">Shortcuts</h3><p className="text-muted"><kbd className="rounded border border-line px-1">Ctrl</kbd> + <kbd className="rounded border border-line px-1">K</kbd> or <kbd className="rounded border border-line px-1">/</kbd> opens search. <kbd className="rounded border border-line px-1">Esc</kbd> closes menus and dialogs.</p></section>
      <section><h3 className="mb-1 font-semibold">About this prototype</h3><p className="text-muted">All records are synthetic demonstration data. Deadlines and reminders are sample values, not AICTE rules. Only authorised people can record statutory decisions; nothing in this tool makes one for them.</p></section>
    </Modal>);
}
