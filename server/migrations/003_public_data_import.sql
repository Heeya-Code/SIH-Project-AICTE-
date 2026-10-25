-- Public-data import pipeline, handbook version tracking and rule activation gating. Additive.

CREATE TABLE data_sources (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  publisher TEXT,
  url TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('institution_directory','report_excel','open_data_catalogue','regulatory_document','other')),
  licence TEXT,
  licence_note TEXT,
  dataset_date TEXT,
  field_definitions_ref TEXT,
  access_status TEXT NOT NULL DEFAULT 'not_attempted' CHECK (access_status IN ('not_attempted','reachable_not_downloaded','requires_manual_download','blocked','downloaded_and_imported')),
  access_checked_on TEXT,
  access_note TEXT,
  usable_for_import INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE import_batches (
  id INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES data_sources(id),
  file_name TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  file_ref TEXT,
  format TEXT NOT NULL CHECK (format IN ('csv','xlsx','json')),
  academic_year TEXT NOT NULL,
  retrieved_on TEXT NOT NULL,
  mapping TEXT,
  status TEXT NOT NULL CHECK (status IN ('completed','completed_with_warnings','rejected','blocked_provenance','duplicate_file')),
  rows_read INTEGER NOT NULL DEFAULT 0,
  rows_new INTEGER NOT NULL DEFAULT 0,
  rows_unchanged INTEGER NOT NULL DEFAULT 0,
  rows_filled INTEGER NOT NULL DEFAULT 0,
  rows_rejected INTEGER NOT NULL DEFAULT 0,
  rows_duplicate INTEGER NOT NULL DEFAULT 0,
  conflicts_opened INTEGER NOT NULL DEFAULT 0,
  possible_duplicates INTEGER NOT NULL DEFAULT 0,
  report TEXT,
  imported_by INTEGER REFERENCES users(id),
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX idx_batch_source ON import_batches(source_id, file_sha256, academic_year);

-- Verified-public records live apart from the fictional demo institutions and are never merged with them.
CREATE TABLE public_institutions (
  id INTEGER PRIMARY KEY,
  aishe_code TEXT UNIQUE,
  name TEXT NOT NULL,
  match_key TEXT NOT NULL,
  state TEXT NOT NULL,
  district TEXT,
  institution_type TEXT,
  management TEXT,
  year_of_establishment INTEGER,
  location TEXT,
  university_name TEXT,
  university_type TEXT,
  source_id INTEGER NOT NULL REFERENCES data_sources(id),
  first_batch_id INTEGER NOT NULL REFERENCES import_batches(id),
  last_batch_id INTEGER NOT NULL REFERENCES import_batches(id),
  academic_year TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'public_import' CHECK (origin = 'public_import'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_pubinst_key ON public_institutions(match_key, state, district);
CREATE INDEX idx_pubinst_state ON public_institutions(state);

CREATE TABLE public_institution_changes (
  id INTEGER PRIMARY KEY,
  institution_id INTEGER NOT NULL REFERENCES public_institutions(id),
  batch_id INTEGER NOT NULL REFERENCES import_batches(id),
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  change_kind TEXT NOT NULL CHECK (change_kind IN ('filled_blank','conflict_resolved_use_incoming')),
  at TEXT NOT NULL
);

CREATE TABLE import_conflicts (
  id INTEGER PRIMARY KEY,
  institution_id INTEGER NOT NULL REFERENCES public_institutions(id),
  batch_id INTEGER NOT NULL REFERENCES import_batches(id),
  row_number INTEGER,
  field TEXT NOT NULL,
  existing_value TEXT,
  incoming_value TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','kept_existing','used_incoming')),
  resolved_by INTEGER REFERENCES users(id),
  resolved_at TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_conflict_status ON import_conflicts(status);

CREATE TABLE import_rejects (
  id INTEGER PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES import_batches(id),
  row_number INTEGER NOT NULL,
  reason TEXT NOT NULL,
  raw TEXT
);

CREATE TABLE import_duplicates (
  id INTEGER PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES import_batches(id),
  kind TEXT NOT NULL CHECK (kind IN ('in_file_identical','in_file_conflicting','possible_near_duplicate')),
  key TEXT NOT NULL,
  row_numbers TEXT,
  detail TEXT
);

-- Handbook versions and amendments, and the gate between regulatory text and active workflow rules.
CREATE TABLE handbook_versions (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('handbook','addendum')),
  academic_years TEXT,
  issued_on TEXT,
  issued_note TEXT,
  url TEXT,
  status TEXT NOT NULL CHECK (status IN ('current','superseded','unknown')),
  text_reviewed INTEGER NOT NULL DEFAULT 0,
  checked_on TEXT,
  check_method TEXT,
  notes TEXT,
  reviewed_by INTEGER REFERENCES users(id)
);

ALTER TABLE regulatory_rules ADD COLUMN handbook_version_id INTEGER REFERENCES handbook_versions(id);
ALTER TABLE regulatory_rules ADD COLUMN workflow_binding TEXT;
ALTER TABLE regulatory_rules ADD COLUMN activation_status TEXT NOT NULL DEFAULT 'not_bound' CHECK (activation_status IN ('not_bound','demo_active','active','suspended'));
