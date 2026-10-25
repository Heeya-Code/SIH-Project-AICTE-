# A3: close the remaining gaps against docs/SPEC.md sections 18 and 22
Implement, with tests, in this order: (1) SMS adapter interface with a simulated adapter, (2) multilingual institution guidance (Hindi + one more language) with the source rule shown beside the explanation,
(3) holiday calendar admin screen feeding `holidays`, (4) bulk reassignment of workload by a Bureau officer with audit and a confirmation step, (5) optional LLM adapter for the assistant that calls only the existing scoped service functions,
never raw SQL, with the rule-based assistant as the fallback.
Acceptance: each item has tests; the app still works with the LLM adapter unset.
