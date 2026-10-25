-- Per-document reminder schedules and automatic renewal task (migration 004)

ALTER TABLE document_requirements ADD COLUMN reminder_days TEXT;
ALTER TABLE document_requirements ADD COLUMN auto_renewal INTEGER NOT NULL DEFAULT 0;

ALTER TABLE undertakings ADD COLUMN document_id INTEGER REFERENCES documents(id);

-- Default Lease Deed reminder schedule and auto-renewal switch (sample values)
UPDATE document_requirements SET reminder_days='[180,90,30]', auto_renewal=1 WHERE doc_type LIKE '%Lease Deed%';
