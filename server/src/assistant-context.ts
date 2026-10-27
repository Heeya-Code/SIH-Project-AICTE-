import type { DB } from './db';
import { roleLabel, type User } from './auth';
import { documentSampleCatalog } from './sample-documents';

const ALL = ['institution', 'regional_officer', 'bureau_officer', 'evc_coordinator', 'competent_authority', 'admin'];
const FEATURES: { name: string; description: string; roles: string[] }[] = [
  { name: 'Dashboard', description: 'Role-specific statistics, pending actions, deadlines, and attention items derived from stored records.', roles: ALL },
  { name: 'Applications', description: 'Create or review applications, follow workflow stages, submit evidence, respond to a return, and view case history.', roles: ALL },
  { name: 'EVC scheduling', description: 'Schedule expert committee visits, check committee availability, record the visit, and store its report.', roles: ['regional_officer', 'bureau_officer', 'evc_coordinator'] },
  { name: 'Tasks and pendency', description: 'View work assigned or awaiting action within the current role and data scope.', roles: ['regional_officer', 'bureau_officer', 'evc_coordinator', 'competent_authority', 'institution'] },
  { name: 'Document validity', description: 'View uploaded documents, recorded verification status, expiry, version history, preview and download; institutions can upload renewals.', roles: ['institution', 'regional_officer', 'bureau_officer'] },
  { name: 'Document verification', description: 'Regional and bureau officers can review current documents and verify or return them with a note.', roles: ['regional_officer', 'bureau_officer'] },
  { name: 'Compliance tracker', description: 'Track obligations, due dates, submitted evidence, reviewer status, and recorded observations.', roles: ['institution', 'regional_officer', 'bureau_officer', 'competent_authority'] },
  { name: 'Inbox and alerts', description: 'Review notifications, acknowledgements, escalation notices, and alerts generated from configured rules.', roles: ALL },
  { name: 'Analytics and reports', description: 'View scoped counts, workload, document expiry, EVC status, exports, and drill-downs to records.', roles: ['regional_officer', 'bureau_officer', 'evc_coordinator', 'competent_authority', 'admin'] },
  { name: 'Regulatory rules', description: 'Inspect indexed rule paraphrases with source and verification state; assumptions are kept separate from verified sources.', roles: ALL },
  { name: 'Workflow designer', description: 'Administrators or bureau officers can validate and version workflow configuration; existing applications retain their workflow version.', roles: ['admin', 'bureau_officer'] },
  { name: 'Audit trail', description: 'Authorised staff can review append-only history for recorded case and system actions.', roles: ['admin', 'bureau_officer', 'competent_authority'] },
  { name: 'Administration', description: 'Administrators manage users, settings, imports, jobs, and demo tools.', roles: ['admin'] },
];

export function websiteKnowledge(db: DB, user: User) {
  const stages = db.prepare(`SELECT w.name AS workflow, s.name, s.responsible_role, s.deadline_days, s.is_evc
    FROM workflow_stages s JOIN workflow_versions v ON v.id=s.version_id JOIN workflows w ON w.id=v.workflow_id
    WHERE v.active=1 ORDER BY w.id, s.id`).all() as any[];
  const categories = db.prepare('SELECT code, name FROM application_categories ORDER BY code').all() as any[];
  const samples = documentSampleCatalog(db).map(x => x.display_name);
  return [
    `Current user role: ${roleLabel[user.role]}. Explain only the capabilities listed for this role.`,
    ...FEATURES.filter(x => x.roles.includes(user.role)).map(x => `${x.name}: ${x.description}`),
    `Application categories configured in this prototype: ${categories.map(x => `${x.name} (${x.code})`).join('; ')}. These are demo configuration, not official eligibility rules.`,
    `Active workflow stages configured in this prototype: ${stages.map(x => `${x.workflow}: ${x.name} (owner role ${x.responsible_role}${x.deadline_days ? `; configured ${x.deadline_days}-day deadline` : ''}${x.is_evc ? '; EVC stage' : ''})`).join('; ')}. Stage deadlines and routing are configurable demo settings, not official statutory deadlines.`,
    `Available fictional document and workflow examples: ${samples.join('; ')}. Samples do not establish compliance or an official requirement.`,
  ];
}
