# AICTE ApprovalFlow: standing rules

Demonstration prototype for SIH 2026 PS4. Spec: `docs/SPEC.md`. Overview: `README.md`. Architecture: `docs/ARCHITECTURE.md`.

## Non-negotiables
- All data is synthetic and labelled so. Never claim a connection to real AICTE systems, official timelines, rules or committee members.
  Deadlines, reminder intervals and escalation delays are configurable sample values.
- The AI/assistant never makes or executes statutory decisions. Deterministic code handles deadlines, permissions and transitions.
- Authorization is enforced on the server for every endpoint and every row (`scope()` / `appScope()` pattern). Never trust a role, region or institution id from the client.
- Every significant action writes an audit event (`audit()`), including who, before/after state and reason. Audit rows are append-only.
- Anything that sends a reminder or escalation must be idempotent (dedupe key) and must work with no browser open.
- Dates: `*_date` = IST calendar date, `*_at` = UTC timestamp set by the server. Use the injectable `clock`, never `Date.now()` in business logic.
- Files: private storage, content sniffing, authenticated download. No user input in file paths.

## Working method
- Read before writing. Run `npm run typecheck && npm test` before claiming a task is done, and report real results. Never say tests passed without running them.
- Add or update tests with every behaviour change (test names in `server/tests` describe expected behaviour).
- No buttons that do nothing, no hard-coded dashboard numbers, no frontend-only simulations of backend rules.
- Prefer small commits. If a requirement is unclear and a wrong guess would be costly, ask; otherwise choose a sensible default and note it in the README limitations.

## Commands
`npm run setup` · `npm run build` · `npm start` · `npm test` · `npm run typecheck` · `npm run reset`
