-- AICTE ApprovalFlow (demonstration prototype) - initial schema.
-- All dates named *_date are IST calendar dates (YYYY-MM-DD). All *_at columns are UTC ISO-8601 timestamps.

CREATE TABLE regions (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE institutions (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT,
  region_id INTEGER NOT NULL REFERENCES regions(id),
  synthetic INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('institution','regional_officer','bureau_officer','evc_coordinator','competent_authority','admin')),
  region_id INTEGER REFERENCES regions(id),
  institution_id INTEGER REFERENCES institutions(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_users_role_region ON users(role, region_id);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT
);

CREATE TABLE holidays (
  date TEXT PRIMARY KEY,
  name TEXT
);

-- ---------------------------------------------------------------- workflow configuration
CREATE TABLE workflows (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT
);

CREATE TABLE workflow_versions (
  id INTEGER PRIMARY KEY,
  workflow_id INTEGER NOT NULL REFERENCES workflows(id),
  version INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE (workflow_id, version)
);

CREATE TABLE workflow_stages (
  id INTEGER PRIMARY KEY,
  version_id INTEGER NOT NULL REFERENCES workflow_versions(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  responsible_role TEXT NOT NULL,
  deadline_days INTEGER,
  day_mode TEXT NOT NULL DEFAULT 'calendar' CHECK (day_mode IN ('calendar','working')),
  is_initial INTEGER NOT NULL DEFAULT 0,
  is_terminal INTEGER NOT NULL DEFAULT 0,
  terminal_status TEXT,
  is_evc INTEGER NOT NULL DEFAULT 0,
  evc_schedule_days INTEGER,
  pos_x REAL,
  pos_y REAL,
  UNIQUE (version_id, key)
);

CREATE TABLE workflow_transitions (
  id INTEGER PRIMARY KEY,
  version_id INTEGER NOT NULL REFERENCES workflow_versions(id) ON DELETE CASCADE,
  from_key TEXT NOT NULL,
  to_key TEXT NOT NULL,
  action TEXT NOT NULL,
  label TEXT,
  requires_reason INTEGER NOT NULL DEFAULT 0,
  auto INTEGER NOT NULL DEFAULT 0,
  allowed_role TEXT,
  prerequisites TEXT NOT NULL DEFAULT '[]',
  UNIQUE (version_id, from_key, action)
);

CREATE TABLE application_categories (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  workflow_id INTEGER NOT NULL REFERENCES workflows(id)
);

CREATE TABLE document_requirements (
  id INTEGER PRIMARY KEY,
  category_code TEXT NOT NULL REFERENCES application_categories(code),
  doc_type TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1,
  has_expiry INTEGER NOT NULL DEFAULT 0,
  UNIQUE (category_code, doc_type)
);

CREATE TABLE undertaking_templates (
  id INTEGER PRIMARY KEY,
  category_code TEXT NOT NULL REFERENCES application_categories(code),
  condition_text TEXT NOT NULL,
  description TEXT NOT NULL,
  required_evidence TEXT NOT NULL,
  due_after_days INTEGER NOT NULL
);

-- ---------------------------------------------------------------- applications
CREATE TABLE applications (
  id INTEGER PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  institution_id INTEGER NOT NULL REFERENCES institutions(id),
  region_id INTEGER NOT NULL REFERENCES regions(id),
  category_code TEXT NOT NULL REFERENCES application_categories(code),
  workflow_version_id INTEGER REFERENCES workflow_versions(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_progress','returned','approved','rejected','withdrawn')),
  current_stage TEXT,
  stage_entered_at TEXT,
  stage_due_date TEXT,
  assigned_user_id INTEGER REFERENCES users(id),
  submitted_at TEXT,
  completed_at TEXT,
  summary TEXT,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_app_status ON applications(status);
CREATE INDEX idx_app_stage ON applications(current_stage);
CREATE INDEX idx_app_region ON applications(region_id);
CREATE INDEX idx_app_inst ON applications(institution_id);
CREATE INDEX idx_app_due ON applications(stage_due_date);

CREATE TABLE application_submissions (
  id INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id),
  version INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('initial','resubmission')),
  note TEXT,
  snapshot TEXT,
  submitted_by INTEGER REFERENCES users(id),
  submitted_at TEXT NOT NULL,
  UNIQUE (application_id, version)
);

CREATE TABLE stage_history (
  id INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id),
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_id INTEGER REFERENCES users(id),
  actor_label TEXT NOT NULL,
  reason TEXT,
  auto INTEGER NOT NULL DEFAULT 0,
  at TEXT NOT NULL
);
CREATE INDEX idx_hist_app ON stage_history(application_id, id);

CREATE TABLE observations (
  id INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id),
  stage_key TEXT NOT NULL,
  author_id INTEGER NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX idx_obs_app ON observations(application_id);

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id),
  institution_id INTEGER NOT NULL,
  region_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  stage_key TEXT,
  role TEXT NOT NULL,
  assigned_user_id INTEGER REFERENCES users(id),
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX idx_tasks_open ON tasks(status, due_date);
CREATE INDEX idx_tasks_assignee ON tasks(assigned_user_id, status);
CREATE INDEX idx_tasks_app ON tasks(application_id);

-- ---------------------------------------------------------------- EVC
CREATE TABLE evc_committees (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  region_id INTEGER NOT NULL REFERENCES regions(id)
);

CREATE TABLE evc_schedules (
  id INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id),
  institution_id INTEGER NOT NULL,
  region_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','scheduled','rescheduled','completed','cancelled')),
  schedule_deadline TEXT NOT NULL,
  completion_deadline TEXT,
  proposed_date TEXT,
  confirmed_date TEXT,
  committee_id INTEGER REFERENCES evc_committees(id),
  reschedule_count INTEGER NOT NULL DEFAULT 0,
  visit_date TEXT,
  visit_notes TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_evc_status ON evc_schedules(status);
CREATE INDEX idx_evc_region ON evc_schedules(region_id);
CREATE INDEX idx_evc_date ON evc_schedules(committee_id, confirmed_date);

CREATE TABLE evc_history (
  id INTEGER PRIMARY KEY,
  evc_id INTEGER NOT NULL REFERENCES evc_schedules(id),
  action TEXT NOT NULL,
  actor_id INTEGER REFERENCES users(id),
  from_date TEXT,
  to_date TEXT,
  committee_id INTEGER,
  reason TEXT,
  at TEXT NOT NULL
);

-- ---------------------------------------------------------------- compliance
CREATE TABLE undertakings (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  institution_id INTEGER NOT NULL REFERENCES institutions(id),
  region_id INTEGER NOT NULL REFERENCES regions(id),
  application_id INTEGER REFERENCES applications(id),
  condition_text TEXT NOT NULL,
  description TEXT NOT NULL,
  required_evidence TEXT NOT NULL,
  verifier_role TEXT NOT NULL DEFAULT 'regional_officer',
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','submitted','under_verification','returned','verified','closed')),
  observations TEXT,
  verified_by INTEGER REFERENCES users(id),
  verified_at TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_und_status_due ON undertakings(status, due_date);
CREATE INDEX idx_und_inst ON undertakings(institution_id);

CREATE TABLE compliance_submissions (
  id INTEGER PRIMARY KEY,
  undertaking_id INTEGER NOT NULL REFERENCES undertakings(id),
  version INTEGER NOT NULL,
  note TEXT NOT NULL,
  file_name TEXT,
  storage_ref TEXT,
  mime TEXT,
  size INTEGER,
  submitted_by INTEGER REFERENCES users(id),
  submitted_at TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','verified','returned')),
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  review_note TEXT,
  UNIQUE (undertaking_id, version)
);

-- ---------------------------------------------------------------- documents
CREATE TABLE documents (
  id INTEGER PRIMARY KEY,
  lineage_id INTEGER,
  institution_id INTEGER NOT NULL REFERENCES institutions(id),
  region_id INTEGER NOT NULL REFERENCES regions(id),
  application_id INTEGER REFERENCES applications(id),
  undertaking_id INTEGER REFERENCES undertakings(id),
  doc_type TEXT NOT NULL,
  reference_no TEXT,
  issue_date TEXT,
  expiry_date TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  is_current INTEGER NOT NULL DEFAULT 1,
  supersedes_id INTEGER REFERENCES documents(id),
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending','verified','returned')),
  verification_note TEXT,
  verified_by INTEGER REFERENCES users(id),
  verified_at TEXT,
  renewal_status TEXT NOT NULL DEFAULT 'not_due' CHECK (renewal_status IN ('not_due','due_for_renewal','expired','renewed')),
  file_name TEXT NOT NULL,
  storage_ref TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  uploaded_by INTEGER REFERENCES users(id),
  uploaded_at TEXT NOT NULL
);
CREATE INDEX idx_doc_expiry ON documents(is_current, expiry_date);
CREATE INDEX idx_doc_inst ON documents(institution_id);
CREATE INDEX idx_doc_app ON documents(application_id);

-- ---------------------------------------------------------------- notifications
CREATE TABLE notification_templates (
  event TEXT PRIMARY KEY,
  title_tpl TEXT NOT NULL,
  body_tpl TEXT NOT NULL,
  channels TEXT NOT NULL DEFAULT 'in_app,email'
);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  event TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  entity_type TEXT,
  entity_id INTEGER,
  dedupe_key TEXT UNIQUE,
  ack_required INTEGER NOT NULL DEFAULT 0,
  acked_at TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_notif_user ON notifications(user_id, read_at);

CREATE TABLE notification_deliveries (
  id INTEGER PRIMARY KEY,
  notification_id INTEGER NOT NULL REFERENCES notifications(id),
  channel TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent','pending','simulated_sent','failed','abandoned')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_attempt_at TEXT,
  next_retry_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_deliv_status ON notification_deliveries(status, next_retry_at);

-- ---------------------------------------------------------------- escalation
CREATE TABLE escalation_rules (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('task_overdue','evc_overdue','undertaking_overdue','document_expired')),
  applies_to_role TEXT,
  level INTEGER NOT NULL,
  after_days INTEGER NOT NULL CHECK (after_days >= 0),
  recipient_role TEXT NOT NULL CHECK (recipient_role IN ('regional_officer','bureau_officer','competent_authority','evc_coordinator')),
  channels TEXT NOT NULL DEFAULT 'in_app,email',
  repeat_every_days INTEGER,
  max_repeats INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE escalation_events (
  id INTEGER PRIMARY KEY,
  rule_id INTEGER NOT NULL REFERENCES escalation_rules(id),
  trigger_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  application_id INTEGER,
  institution_id INTEGER NOT NULL,
  region_id INTEGER NOT NULL,
  level INTEGER NOT NULL,
  recipient_user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','cancelled')),
  reason TEXT NOT NULL,
  overdue_days INTEGER NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  triggered_at TEXT NOT NULL,
  acked_at TEXT,
  acked_by INTEGER,
  cancelled_at TEXT,
  cancel_reason TEXT
);
CREATE INDEX idx_esc_entity ON escalation_events(entity_type, entity_id, status);

-- ---------------------------------------------------------------- audit trail (append-only, hash-linked)
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  actor_id INTEGER,
  actor_label TEXT NOT NULL,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  prev_state TEXT,
  new_state TEXT,
  reason TEXT,
  correlation_id TEXT,
  at TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_type ON audit_log(event_type);

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

-- ---------------------------------------------------------------- background jobs
CREATE TABLE job_runs (
  id INTEGER PRIMARY KEY,
  trigger TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running','ok','partial','failed')),
  sim_date TEXT,
  summary TEXT,
  error TEXT
);
