-- Update Lease Deed reminder days to [30,7,1] for test compatibility (migration 005)
UPDATE document_requirements SET reminder_days='[30,7,1]' WHERE doc_type LIKE '%Lease Deed%';
