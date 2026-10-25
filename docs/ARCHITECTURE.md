# Architecture notes

## Time rules
- `*_at` columns: UTC ISO timestamps, set by the server (`clock.iso()`).
- `*_date` columns (due dates, expiry dates): IST calendar dates `YYYY-MM-DD`. "Today" is the IST date. India has no DST, so a fixed +05:30 offset is exact.
- `clock` can be pinned (demo tool and tests) so deadline behaviour is deterministic.

## Data model (relationships)
```
regions 1─* institutions 1─* users
regions 1─* users (officers)           workflows 1─* workflow_versions 1─* workflow_stages / workflow_transitions
application_categories *─1 workflows   applications *─1 workflow_versions   (an application keeps its version)
applications 1─* stage_history, observations, application_submissions, tasks, evc_schedules, undertakings, documents
evc_schedules 1─* evc_history; evc_committees 1─* evc_schedules
undertakings 1─* compliance_submissions (versioned, each with its own review state)
documents: lineage_id groups versions; supersedes_id links v(n) to v(n-1); is_current marks the live one
notifications 1─* notification_deliveries (in_app, email outbox)   notification_templates by event
escalation_rules 1─* escalation_events (one per recipient)   audit_log (hash-linked, triggers block UPDATE/DELETE)
job_runs, settings, holidays
```

## Workflow engine rules
1. Transition = `(from_stage, action)` in the application's own workflow version. Role = transition `allowed_role` or the stage's responsible role.
2. Checked on the server in one transaction: visibility, optimistic-lock `row_version`, role, mandatory reason, prerequisites
   (`required_docs_present`, `required_docs_verified`, `observation_recorded`, `evc_completed`).
3. On success: open tasks complete, history row, audit row, next stage entered (deadline, assignee by least open load, task, EVC queue entry, notifications), stale escalations cancelled.
4. Transitions marked `auto` fire by themselves once their prerequisites hold (bounded loop; validator rejects automatic cycles).
5. New workflow versions never alter existing applications.

## Reminders and escalations
- Reminders use *buckets* ("smallest configured threshold ≥ days left"), so a missed day still produces exactly one reminder per threshold.
- Notification `dedupe_key` is unique; escalation events have a unique `(rule, entity, repeat index, recipient)` key. Re-running jobs creates nothing new.
- Escalation recipients are computed from the entity's own Region/institution, restricted to officer roles by a CHECK constraint.
- Email uses an outbox: rows are written in the business transaction; delivery happens afterwards with backoff (5 min, 30 min, 2 h) then `abandoned`.

## Access scope
institution → own institution; regional officer / EVC coordinator → own Region; bureau, competent authority, admin → national.
Drafts are visible only to the institution. Internal observations and escalations are hidden from institutions.
