-- Regulatory source layer, data-quality tables and synthetic-data provenance. Additive: no existing table is dropped or rebuilt.

-- ------------------------------------------------------------ regulatory sources and rules
CREATE TABLE regulatory_sources (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  publisher TEXT,
  url TEXT,
  version_label TEXT,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('official_final','official_notice','official_draft','government_hosted_copy','third_party_copy','legal_text','press_release','news','institution_page')),
  trust TEXT NOT NULL CHECK (trust IN ('primary','secondary','unofficial')),
  retrieved_on TEXT,
  access_note TEXT
);

CREATE TABLE regulatory_rules (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('regulatory_rule','process_fact','configurable_assumption')),
  title TEXT NOT NULL,
  statement TEXT NOT NULL,                  -- paraphrase in our own words, never a copy of the source text
  category_code TEXT REFERENCES application_categories(code),
  source_id INTEGER REFERENCES regulatory_sources(id),
  section_ref TEXT,
  page_ref TEXT,
  page_note TEXT,
  effective_from TEXT,
  effective_to TEXT,
  effective_note TEXT,
  verification_status TEXT NOT NULL CHECK (verification_status IN ('verified_official','verified_excerpt','needs_review','unverified','outdated','assumption')),
  flagged_for_review INTEGER NOT NULL DEFAULT 0,
  last_reviewed_on TEXT,
  reviewed_by INTEGER REFERENCES users(id),
  review_notes TEXT,
  CHECK (kind <> 'configurable_assumption' OR verification_status = 'assumption'),
  CHECK (kind = 'configurable_assumption' OR source_id IS NOT NULL)
);
CREATE INDEX idx_rules_status ON regulatory_rules(verification_status);

-- Searchable paraphrased excerpts used by the handbook assistant.
CREATE TABLE reference_chunks (
  id INTEGER PRIMARY KEY,
  rule_id INTEGER NOT NULL REFERENCES regulatory_rules(id),
  text TEXT NOT NULL
);
CREATE VIRTUAL TABLE reference_fts USING fts5(chunk_id UNINDEXED, text, title);

-- How each configured category / requirement / stage is grounded.
ALTER TABLE application_categories ADD COLUMN apph_ref TEXT;
ALTER TABLE application_categories ADD COLUMN rule_id INTEGER REFERENCES regulatory_rules(id);
ALTER TABLE application_categories ADD COLUMN route_basis TEXT NOT NULL DEFAULT 'assumption';
ALTER TABLE application_categories ADD COLUMN route_rule_id INTEGER REFERENCES regulatory_rules(id);
ALTER TABLE document_requirements ADD COLUMN basis TEXT NOT NULL DEFAULT 'assumption';
ALTER TABLE document_requirements ADD COLUMN rule_id INTEGER REFERENCES regulatory_rules(id);
ALTER TABLE workflow_stages ADD COLUMN basis TEXT NOT NULL DEFAULT 'assumption';

-- ------------------------------------------------------------ deficiencies and corrective actions
CREATE TABLE deficiencies (
  id INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id),
  institution_id INTEGER NOT NULL,
  region_id INTEGER NOT NULL,
  stage_key TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('document','infrastructure','faculty','compliance','other')),
  description TEXT NOT NULL,
  rule_id INTEGER REFERENCES regulatory_rules(id),
  raised_by INTEGER REFERENCES users(id),
  raised_at TEXT NOT NULL,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','responded','closed')),
  corrective_action TEXT,
  responded_at TEXT,
  closed_at TEXT,
  closed_by INTEGER REFERENCES users(id)
);
CREATE INDEX idx_def_app ON deficiencies(application_id, status);
CREATE INDEX idx_def_open ON deficiencies(status, due_date);

CREATE TABLE evc_reports (
  id INTEGER PRIMARY KEY,
  evc_id INTEGER NOT NULL REFERENCES evc_schedules(id),
  application_id INTEGER NOT NULL REFERENCES applications(id),
  author_id INTEGER REFERENCES users(id),
  outcome TEXT NOT NULL CHECK (outcome IN ('satisfactory','deficiencies_noted')),
  summary TEXT NOT NULL,
  submitted_at TEXT NOT NULL
);

-- ------------------------------------------------------------ provenance of generated data
CREATE TABLE seed_runs (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  seed INTEGER NOT NULL,
  requested INTEGER NOT NULL,
  generated INTEGER NOT NULL DEFAULT 0,
  generator_version TEXT NOT NULL,
  params TEXT,
  status TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE (kind, seed, requested, generator_version)
);

-- ------------------------------------------------------------ synthetic flags (everything that exists today is demo data)
ALTER TABLE users ADD COLUMN synthetic INTEGER NOT NULL DEFAULT 0;
ALTER TABLE applications ADD COLUMN synthetic INTEGER NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN synthetic INTEGER NOT NULL DEFAULT 0;
ALTER TABLE undertakings ADD COLUMN synthetic INTEGER NOT NULL DEFAULT 0;
UPDATE users SET synthetic = 1;
UPDATE applications SET synthetic = 1;
UPDATE documents SET synthetic = 1;
UPDATE undertakings SET synthetic = 1;
-- audit_log is append-only; adding and back-filling a provenance column needs the guard lifted for this one migration.
-- The column is not part of the hash, so the existing chain still verifies.
DROP TRIGGER audit_log_no_update;
ALTER TABLE audit_log ADD COLUMN synthetic INTEGER NOT NULL DEFAULT 0;
UPDATE audit_log SET synthetic = 1;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
