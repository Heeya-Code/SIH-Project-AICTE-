# B1: Spring Boot foundation (Track B)
Create `backend/` (Spring Boot 3, Java 21, Maven). Flyway `V1__init.sql` ported from `server/migrations/001_init.sql` per `docs/PORTING.md`. Docker Compose with PostgreSQL.
Spring Security with JWT, BCrypt, the six roles. A `DataScope` mechanism applied to every repository query (institution, region, national).
Acceptance: app starts from empty DB; login works for seeded users; an MockMvc test proves Institution A cannot read Institution B's application.
