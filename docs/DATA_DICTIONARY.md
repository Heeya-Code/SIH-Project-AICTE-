# Data dictionary

Generated from the database schema (migrations 001 and 002) by `server/scripts/gen-docs.ts`. Run `npm --prefix server run docs` to refresh.

**Conventions.** `*_at` columns are UTC ISO timestamps set by the server. `*_date` columns are IST calendar dates (`YYYY-MM-DD`). `synthetic = 1` marks rows created by the seed or the generator: institutions, users, applications, documents, undertakings and audit events.

## application_categories

Application categories with the handbook section (`apph_ref`) and whether the stage route is verified (`route_basis`).

| Column | Type | Notes |
|---|---|---|
| code | TEXT | primary key |
| name | TEXT | required |
| workflow_id | INTEGER | required; references workflows |
| apph_ref | TEXT |  |
| rule_id | INTEGER | references regulatory_rules |
| route_basis | TEXT | required |
| route_rule_id | INTEGER | references regulatory_rules |

## application_submissions

Every submission and resubmission, with a snapshot of the documents on file.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| application_id | INTEGER | required; references applications |
| version | INTEGER | required |
| kind | TEXT | required |
| note | TEXT |  |
| snapshot | TEXT |  |
| submitted_by | INTEGER | references users |
| submitted_at | TEXT | required |

## applications

Applications. `synthetic=1` for generated data. Status and stage follow the workflow version.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| ref | TEXT | required |
| title | TEXT | required |
| institution_id | INTEGER | required; references institutions |
| region_id | INTEGER | required; references regions |
| category_code | TEXT | required; references application_categories |
| workflow_version_id | INTEGER | references workflow_versions |
| status | TEXT | required |
| current_stage | TEXT |  |
| stage_entered_at | TEXT |  |
| stage_due_date | TEXT |  |
| assigned_user_id | INTEGER | references users |
| submitted_at | TEXT |  |
| completed_at | TEXT |  |
| summary | TEXT |  |
| row_version | INTEGER | required |
| created_by | INTEGER | references users |
| created_at | TEXT | required |
| updated_at | TEXT | required |
| synthetic | INTEGER | required |

## audit_log

Append-only, hash-linked audit trail. `synthetic` marks events produced while generating demo data (not part of the hash).

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| event_id | TEXT | required |
| actor_id | INTEGER |  |
| actor_label | TEXT | required |
| event_type | TEXT | required |
| entity_type | TEXT | required |
| entity_id | TEXT |  |
| prev_state | TEXT |  |
| new_state | TEXT |  |
| reason | TEXT |  |
| correlation_id | TEXT |  |
| at | TEXT | required |
| prev_hash | TEXT | required |
| hash | TEXT | required |
| synthetic | INTEGER | required |

## compliance_submissions

Versioned evidence submissions with review status.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| undertaking_id | INTEGER | required; references undertakings |
| version | INTEGER | required |
| note | TEXT | required |
| file_name | TEXT |  |
| storage_ref | TEXT |  |
| mime | TEXT |  |
| size | INTEGER |  |
| submitted_by | INTEGER | references users |
| submitted_at | TEXT | required |
| review_status | TEXT | required |
| reviewed_by | INTEGER | references users |
| reviewed_at | TEXT |  |
| review_note | TEXT |  |

## data_sources

Registry of public datasets and documents: licence, field definitions and what was actually done to access them.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| code | TEXT | required |
| name | TEXT | required |
| publisher | TEXT |  |
| url | TEXT |  |
| kind | TEXT | required |
| licence | TEXT |  |
| licence_note | TEXT |  |
| dataset_date | TEXT |  |
| field_definitions_ref | TEXT |  |
| access_status | TEXT | required |
| access_checked_on | TEXT |  |
| access_note | TEXT |  |
| usable_for_import | INTEGER | required |
| created_at | TEXT | required |

## deficiencies

Deficiencies raised on return, with the institution's corrective action and closure.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| application_id | INTEGER | required; references applications |
| institution_id | INTEGER | required |
| region_id | INTEGER | required |
| stage_key | TEXT | required |
| category | TEXT | required |
| description | TEXT | required |
| rule_id | INTEGER | references regulatory_rules |
| raised_by | INTEGER | references users |
| raised_at | TEXT | required |
| due_date | TEXT |  |
| status | TEXT | required |
| corrective_action | TEXT |  |
| responded_at | TEXT |  |
| closed_at | TEXT |  |
| closed_by | INTEGER | references users |

## document_requirements

Required documents per category with `basis` and the supporting rule.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| category_code | TEXT | required; references application_categories |
| doc_type | TEXT | required |
| required | INTEGER | required |
| has_expiry | INTEGER | required |
| basis | TEXT | required |
| rule_id | INTEGER | references regulatory_rules |

## documents

Document versions. `lineage_id` groups versions; `is_current` marks the live one; `synthetic` flags generated files. For synthetic records, the protected download route generates a detailed fictional PDF from the stored record metadata instead of returning the seed's tiny placeholder file. Non-synthetic records are read from private storage unchanged.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| lineage_id | INTEGER |  |
| institution_id | INTEGER | required; references institutions |
| region_id | INTEGER | required; references regions |
| application_id | INTEGER | references applications |
| undertaking_id | INTEGER | references undertakings |
| doc_type | TEXT | required |
| reference_no | TEXT |  |
| issue_date | TEXT |  |
| expiry_date | TEXT |  |
| version | INTEGER | required |
| is_current | INTEGER | required |
| supersedes_id | INTEGER | references documents |
| verification_status | TEXT | required |
| verification_note | TEXT |  |
| verified_by | INTEGER | references users |
| verified_at | TEXT |  |
| renewal_status | TEXT | required |
| file_name | TEXT | required |
| storage_ref | TEXT | required |
| mime | TEXT | required |
| size | INTEGER | required |
| uploaded_by | INTEGER | references users |
| uploaded_at | TEXT | required |
| synthetic | INTEGER | required |

## escalation_events

Escalations raised, acknowledged or cancelled.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| rule_id | INTEGER | required; references escalation_rules |
| trigger_type | TEXT | required |
| entity_type | TEXT | required |
| entity_id | INTEGER | required |
| application_id | INTEGER |  |
| institution_id | INTEGER | required |
| region_id | INTEGER | required |
| level | INTEGER | required |
| recipient_user_id | INTEGER | required; references users |
| status | TEXT | required |
| reason | TEXT | required |
| overdue_days | INTEGER | required |
| dedupe_key | TEXT | required |
| triggered_at | TEXT | required |
| acked_at | TEXT |  |
| acked_by | INTEGER |  |
| cancelled_at | TEXT |  |
| cancel_reason | TEXT |  |

## escalation_rules

Configurable escalation policy.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| name | TEXT | required |
| trigger_type | TEXT | required |
| applies_to_role | TEXT |  |
| level | INTEGER | required |
| after_days | INTEGER | required |
| recipient_role | TEXT | required |
| channels | TEXT | required |
| repeat_every_days | INTEGER |  |
| max_repeats | INTEGER | required |
| active | INTEGER | required |

## evc_committees

Fictional EVC panels.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| name | TEXT | required |
| region_id | INTEGER | required; references regions |

## evc_history

Scheduling history including reasons.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| evc_id | INTEGER | required; references evc_schedules |
| action | TEXT | required |
| actor_id | INTEGER | references users |
| from_date | TEXT |  |
| to_date | TEXT |  |
| committee_id | INTEGER |  |
| reason | TEXT |  |
| at | TEXT | required |

## evc_reports

Report recorded when a visit is completed (outcome and summary).

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| evc_id | INTEGER | required; references evc_schedules |
| application_id | INTEGER | required; references applications |
| author_id | INTEGER | references users |
| outcome | TEXT | required |
| summary | TEXT | required |
| submitted_at | TEXT | required |

## evc_schedules

EVC queue entry, scheduling, rescheduling count and completion for an application.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| application_id | INTEGER | required; references applications |
| institution_id | INTEGER | required |
| region_id | INTEGER | required |
| status | TEXT | required |
| schedule_deadline | TEXT | required |
| completion_deadline | TEXT |  |
| proposed_date | TEXT |  |
| confirmed_date | TEXT |  |
| committee_id | INTEGER | references evc_committees |
| reschedule_count | INTEGER | required |
| visit_date | TEXT |  |
| visit_notes | TEXT |  |
| completed_at | TEXT |  |
| created_at | TEXT | required |
| updated_at | TEXT | required |

## handbook_versions

Handbook and addendum versions, whether they are current, and whether their text has been reviewed.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| code | TEXT | required |
| title | TEXT | required |
| kind | TEXT | required |
| academic_years | TEXT |  |
| issued_on | TEXT |  |
| issued_note | TEXT |  |
| url | TEXT |  |
| status | TEXT | required |
| text_reviewed | INTEGER | required |
| checked_on | TEXT |  |
| check_method | TEXT |  |
| notes | TEXT |  |
| reviewed_by | INTEGER | references users |

## holidays

Optional non-working days for working-day deadline maths. Empty: no official calendar is bundled.

| Column | Type | Notes |
|---|---|---|
| date | TEXT | primary key |
| name | TEXT |  |

## import_batches

One row per import attempt (including blocked, rejected and skipped ones) with counts and the full data-quality report.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| source_id | INTEGER | required; references data_sources |
| file_name | TEXT | required |
| file_sha256 | TEXT | required |
| file_ref | TEXT |  |
| format | TEXT | required |
| academic_year | TEXT | required |
| retrieved_on | TEXT | required |
| mapping | TEXT |  |
| status | TEXT | required |
| rows_read | INTEGER | required |
| rows_new | INTEGER | required |
| rows_unchanged | INTEGER | required |
| rows_filled | INTEGER | required |
| rows_rejected | INTEGER | required |
| rows_duplicate | INTEGER | required |
| conflicts_opened | INTEGER | required |
| possible_duplicates | INTEGER | required |
| report | TEXT |  |
| imported_by | INTEGER | references users |
| started_at | TEXT | required |
| finished_at | TEXT |  |

## import_conflicts

Disagreements between a new file and a stored record. Stored values are kept until a person decides.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| institution_id | INTEGER | required; references public_institutions |
| batch_id | INTEGER | required; references import_batches |
| row_number | INTEGER |  |
| field | TEXT | required |
| existing_value | TEXT |  |
| incoming_value | TEXT |  |
| status | TEXT | required |
| resolved_by | INTEGER | references users |
| resolved_at | TEXT |  |
| note | TEXT |  |
| created_at | TEXT | required |

## import_duplicates

Duplicates found in a file, and possible near-duplicates against stored records.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| batch_id | INTEGER | required; references import_batches |
| kind | TEXT | required |
| key | TEXT | required |
| row_numbers | TEXT |  |
| detail | TEXT |  |

## import_rejects

Rows rejected during an import, with the reason and the raw row.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| batch_id | INTEGER | required; references import_batches |
| row_number | INTEGER | required |
| reason | TEXT | required |
| raw | TEXT |  |

## institutions

Fictional institutions (all marked synthetic).

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| name | TEXT | required |
| city | TEXT |  |
| region_id | INTEGER | required; references regions |
| synthetic | INTEGER | required |

## job_runs

Background job runs and failures.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| trigger | TEXT | required |
| started_at | TEXT | required |
| finished_at | TEXT |  |
| status | TEXT | required |
| sim_date | TEXT |  |
| summary | TEXT |  |
| error | TEXT |  |

## notification_deliveries

Delivery attempts per channel (email is simulated).

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| notification_id | INTEGER | required; references notifications |
| channel | TEXT | required |
| status | TEXT | required |
| attempts | INTEGER | required |
| last_error | TEXT |  |
| last_attempt_at | TEXT |  |
| next_retry_at | TEXT |  |
| created_at | TEXT | required |

## notification_templates

Message templates per event.

| Column | Type | Notes |
|---|---|---|
| event | TEXT | primary key |
| title_tpl | TEXT | required |
| body_tpl | TEXT | required |
| channels | TEXT | required |

## notifications

In-app notifications (de-duplicated by `dedupe_key`).

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| user_id | INTEGER | required; references users |
| event | TEXT | required |
| title | TEXT | required |
| body | TEXT | required |
| link | TEXT |  |
| entity_type | TEXT |  |
| entity_id | INTEGER |  |
| dedupe_key | TEXT |  |
| ack_required | INTEGER | required |
| acked_at | TEXT |  |
| read_at | TEXT |  |
| created_at | TEXT | required |

## observations

Reviewer observations (internal, hidden from institutions).

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| application_id | INTEGER | required; references applications |
| stage_key | TEXT | required |
| author_id | INTEGER | required; references users |
| text | TEXT | required |
| at | TEXT | required |

## public_institution_changes

Every change to a public record after first import: blanks filled, or conflicts a person resolved.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| institution_id | INTEGER | required; references public_institutions |
| batch_id | INTEGER | required; references import_batches |
| field | TEXT | required |
| old_value | TEXT |  |
| new_value | TEXT |  |
| change_kind | TEXT | required |
| at | TEXT | required |

## public_institutions

Institution records imported from published files. Kept separate from the fictional demo `institutions`; `origin` is always `public_import`.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| aishe_code | TEXT |  |
| name | TEXT | required |
| match_key | TEXT | required |
| state | TEXT | required |
| district | TEXT |  |
| institution_type | TEXT |  |
| management | TEXT |  |
| year_of_establishment | INTEGER |  |
| location | TEXT |  |
| university_name | TEXT |  |
| university_type | TEXT |  |
| source_id | INTEGER | required; references data_sources |
| first_batch_id | INTEGER | required; references import_batches |
| last_batch_id | INTEGER | required; references import_batches |
| academic_year | TEXT | required |
| origin | TEXT | required |
| created_at | TEXT | required |
| updated_at | TEXT | required |

## reference_chunks

Paraphrased excerpts searchable by the handbook assistant using SQLite FTS5 ranking. An optional server-configured OpenAI-compatible model may explain retrieved excerpts; no model is enabled by default. Generated sample-document content is structured server-side and can be retrieved by the assistant separately from regulatory evidence. PDF ingestion and automatic official-source browsing are not implemented.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| rule_id | INTEGER | required; references regulatory_rules |
| text | TEXT | required |

## regions

Regions of the demonstration.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| code | TEXT | required |
| name | TEXT | required |

## regulatory_rules

Rules, process facts and demonstration assumptions with verification status, section, page note and review history.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| code | TEXT | required |
| kind | TEXT | required |
| title | TEXT | required |
| statement | TEXT | required |
| category_code | TEXT | references application_categories |
| source_id | INTEGER | references regulatory_sources |
| section_ref | TEXT |  |
| page_ref | TEXT |  |
| page_note | TEXT |  |
| effective_from | TEXT |  |
| effective_to | TEXT |  |
| effective_note | TEXT |  |
| verification_status | TEXT | required |
| flagged_for_review | INTEGER | required |
| last_reviewed_on | TEXT |  |
| reviewed_by | INTEGER | references users |
| review_notes | TEXT |  |
| handbook_version_id | INTEGER | references handbook_versions |
| workflow_binding | TEXT |  |
| activation_status | TEXT | required |

## regulatory_sources

Sources consulted, with trust level and whether they were actually retrieved.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| code | TEXT | required |
| title | TEXT | required |
| publisher | TEXT |  |
| url | TEXT |  |
| version_label | TEXT |  |
| source_kind | TEXT | required |
| trust | TEXT | required |
| retrieved_on | TEXT |  |
| access_note | TEXT |  |

## schema_migrations

Applied migrations.

| Column | Type | Notes |
|---|---|---|
| version | INTEGER | primary key |
| name | TEXT | required |
| applied_at | TEXT | required |

## seed_runs

Records each generator run (seed, count, version) so it is never repeated.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| kind | TEXT | required |
| seed | INTEGER | required |
| requested | INTEGER | required |
| generated | INTEGER | required |
| generator_version | TEXT | required |
| params | TEXT |  |
| status | TEXT | required |
| started_at | TEXT | required |
| finished_at | TEXT |  |

## settings

Configurable policy values (reminder intervals, thresholds).

| Column | Type | Notes |
|---|---|---|
| key | TEXT | primary key |
| value | TEXT | required |
| description | TEXT |  |

## stage_history

Every stage change: actor, reason, automatic or manual.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| application_id | INTEGER | required; references applications |
| from_stage | TEXT |  |
| to_stage | TEXT | required |
| action | TEXT | required |
| actor_id | INTEGER | references users |
| actor_label | TEXT | required |
| reason | TEXT |  |
| auto | INTEGER | required |
| at | TEXT | required |

## tasks

Open and completed stage tasks, with owner role and deadline.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| application_id | INTEGER | required; references applications |
| institution_id | INTEGER | required |
| region_id | INTEGER | required |
| type | TEXT | required |
| title | TEXT | required |
| stage_key | TEXT |  |
| role | TEXT | required |
| assigned_user_id | INTEGER | references users |
| due_date | TEXT |  |
| status | TEXT | required |
| created_at | TEXT | required |
| completed_at | TEXT |  |

## undertaking_templates

Obligations created automatically when an application is approved.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| category_code | TEXT | required; references application_categories |
| condition_text | TEXT | required |
| description | TEXT | required |
| required_evidence | TEXT | required |
| due_after_days | INTEGER | required |

## undertakings

Time-bound obligations. Status changes only by explicit actions; "overdue" is derived from the due date.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| code | TEXT | required |
| institution_id | INTEGER | required; references institutions |
| region_id | INTEGER | required; references regions |
| application_id | INTEGER | references applications |
| condition_text | TEXT | required |
| description | TEXT | required |
| required_evidence | TEXT | required |
| verifier_role | TEXT | required |
| due_date | TEXT | required |
| status | TEXT | required |
| observations | TEXT |  |
| verified_by | INTEGER | references users |
| verified_at | TEXT |  |
| created_by | INTEGER | references users |
| created_at | TEXT | required |
| synthetic | INTEGER | required |

## users

Users and roles. `synthetic=1` for generated or seeded users.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| email | TEXT | required |
| name | TEXT | required |
| password_hash | TEXT | required |
| role | TEXT | required |
| region_id | INTEGER | references regions |
| institution_id | INTEGER | references institutions |
| active | INTEGER | required |
| created_at | TEXT | required |
| synthetic | INTEGER | required |

## workflow_stages

Stages of a version. `basis` records whether a stage setting is a verified rule or an assumption.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| version_id | INTEGER | required; references workflow_versions |
| key | TEXT | required |
| name | TEXT | required |
| responsible_role | TEXT | required |
| deadline_days | INTEGER |  |
| day_mode | TEXT | required |
| is_initial | INTEGER | required |
| is_terminal | INTEGER | required |
| terminal_status | TEXT |  |
| is_evc | INTEGER | required |
| evc_schedule_days | INTEGER |  |
| pos_x | REAL |  |
| pos_y | REAL |  |
| basis | TEXT | required |

## workflow_transitions

Allowed transitions, required roles and prerequisites.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| version_id | INTEGER | required; references workflow_versions |
| from_key | TEXT | required |
| to_key | TEXT | required |
| action | TEXT | required |
| label | TEXT |  |
| requires_reason | INTEGER | required |
| auto | INTEGER | required |
| allowed_role | TEXT |  |
| prerequisites | TEXT | required |

## workflow_versions

Versioned workflow definitions. An application keeps the version it started on.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| workflow_id | INTEGER | required; references workflows |
| version | INTEGER | required |
| active | INTEGER | required |
| note | TEXT |  |
| created_by | INTEGER | references users |
| created_at | TEXT | required |

## workflows

Workflow families.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| code | TEXT | required |
| name | TEXT | required |
| description | TEXT |  |
