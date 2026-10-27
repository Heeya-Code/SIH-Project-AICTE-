-- Intentionally empty.
-- This migration used to overwrite the Lease Deed reminder schedule with [30,7,1] "for test compatibility", which made existing databases
-- behave differently from freshly seeded ones. The schedule now comes only from the seed ([180,90,30]) or from an administrator's edit.
SELECT 1;
