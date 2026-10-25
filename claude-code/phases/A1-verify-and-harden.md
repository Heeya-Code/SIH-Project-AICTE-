# A1: verify the baseline and harden it

Goal: confirm the repository works from a clean clone, then close the known gaps.
1. Fresh clone: `npm run setup && npm run build && npm test && npm start`. Fix anything that fails. Report exact output.
2. Run the app and click through each role's dashboard. List every visual or functional defect you find (do not guess; use the browser tool or Playwright).
3. Add Playwright and write end-to-end tests for: submit and route an application; return and resubmit; EVC schedule and complete; evidence submit and verify; renew a document.
4. Security pass: move the JWT to an httpOnly SameSite cookie with CSRF protection; add per-account login throttling stored in the database; add a password-change screen.
Acceptance: all tests green including the new E2E ones; README limitations updated to match reality.
Do not: change the workflow engine rules or schema without a migration and a test.
