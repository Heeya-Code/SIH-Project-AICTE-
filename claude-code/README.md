# Using these prompts with Claude Code

Your original master prompt is a good spec but too large to work from in one go. Split it:

1. **`CLAUDE.md`** (put it at the repo root). Standing rules that apply to every session: honesty, security, testing, data. Keep it short.
2. **One phase prompt per session** (`phases/*.md`). Each has a goal, scope, acceptance checks and a "do not".
   Run them in order, commit after each, and start a fresh session per phase.
3. Keep your original master prompt as `docs/SPEC.md` and let phase prompts refer to its numbered sections.

## Choose a track

**Track A (recommended for the hackathon timeline): extend this repository.** It already runs, has 58 server tests and a built UI.
Use phases A1 to A5. Your own prompt says to keep a working stack and document deviations; the deviation is documented in `README.md`.

**Track B: port to Java/Spring Boot + PostgreSQL** as the brief prefers. Use phases B1 to B4 after reading `docs/PORTING.md`.
Treat `server/tests` as the acceptance checklist, and `server/migrations/001_init.sql` as the schema reference.

Suggested split for a team: one person on Track A polish and demo, another on Track B only if the judges explicitly need the Java stack.
