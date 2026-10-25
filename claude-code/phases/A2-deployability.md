# A2: make it deployable

- Add `Dockerfile` (multi-stage) and `docker-compose.yml` for the app with a mounted volume for `data/`.
- Make the DB layer switchable to PostgreSQL behind a thin repository interface only if Track B is not being pursued; otherwise skip.
- Health endpoints, structured JSON logs with correlation ids, graceful shutdown, `ALLOW_DEMO_TOOLS=false` verified to disable reset and clock.
- Document multi-instance scheduling (single scheduler node or DB advisory lock) and implement the lock.
Acceptance: `docker compose up` serves the app; a restart mid-run produces no duplicate notifications (add a test).
