# B2: workflow engine (Track B)
Port `server/src/workflow.ts` and the workflow tests in `server/tests/workflow.test.ts` as JUnit tests FIRST (they should fail), then implement `WorkflowService`: transactional transitions,
`@Version` optimistic locking, prerequisites strategy, auto-advance with a loop guard, versioned definitions, validator and simulator.
Acceptance: every behaviour in the original test names is covered and passing, including the concurrent-transition test.
