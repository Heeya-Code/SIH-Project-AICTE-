# Mapping to the Spring Boot / PostgreSQL stack in the original brief

| This prototype | Spring Boot equivalent |
|---|---|
| `migrations/001_init.sql` | Flyway `V1__init.sql`. Replace `INTEGER PRIMARY KEY` with `BIGINT GENERATED ALWAYS AS IDENTITY`, text dates with `DATE`/`TIMESTAMPTZ`, CHECK constraints stay. Audit triggers become a PL/pgSQL trigger or revoked UPDATE/DELETE privileges. |
| `workflow.ts` | `WorkflowService` with `@Transactional`; `@Version` on `Application` for optimistic locking; prerequisites as a `Prerequisite` strategy interface. |
| `jobs.ts` / `startScheduler` | `@Scheduled` or Quartz with JDBC job store; use ShedLock for multi-instance safety. |
| `notify.ts` outbox | Same outbox table + `@Scheduled` sender using `JavaMailSender`. |
| `auth.ts` scope helpers | Spring Security method security + a `DataScope` specification applied to every repository query. |
| `routes/*.ts` zod | Controllers + Bean Validation DTOs. |
| `reports.ts` | JPQL/SQL views; CSV/PDF with OpenCSV and OpenPDF. |
| `insights.ts` assistant | Keep rule-based first; an LLM adapter would call these same scoped services, never raw SQL. |
| vitest + supertest | JUnit 5 + Spring Boot Test + MockMvc; the test names in `server/tests` are a ready checklist. |

The React front end needs no change except the API base URL and token handling.
