# B3: monitoring, notifications, escalation (Track B)
Port `jobs.ts`, `notify.ts`, `escalation.ts`, `evc.ts`, `compliance.ts`, `documents.ts` with their tests (`deadlines`, `evc`, `compliance`). Use a `Clock` bean so tests can pin time.
Outbox + `@Scheduled` sender, ShedLock for multi-instance, unique constraints for dedupe. Acceptance: reminder deduplication, missed-day recovery, escalation suppression and the IST date-boundary test all pass.
