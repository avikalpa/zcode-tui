# Queue attempt outcomes and work acceptance

The dispatcher no longer creates a completed work claim from exit zero,
a deliverable path, or an orphan transcript. Successful local transport
enters `review_pending`. A remote idle-ticket marker enters `submitted`:
the ticket exists, while the actual remote work and acceptance are unknown.
An orphan budget or interrupted-tool outcome enters `retained_partial`.
Every dispatch has a fresh `dispatch_id`, also used in physical attempt
filenames and dispatch events. Reused attempt ordinals cannot overwrite an
earlier artifact. Exit, orphan recovery and shutdown updates compare the
current running dispatch atomically; losing ownership retains the current
owner state. Existing databases add the field transactionally, rechecking
columns under the migration lock. Legacy empty IDs remain unverified.

These states preserve the task, result reference and log, leave finished_at
unset, free the execution slot, and remain visible in queue list/status.
They are held from automatic redispatch and ordinary rerouting until their
unresolved lifecycle is reconciled. Owner cancellation remains available.

No automatic canonical acceptance transition or independent review-job
dispatch is implemented by this increment. That is a remaining requirement:
it must bind the original task and criteria to the actual current subject
and genuine configured-editor verdict, preserve repair history, and resist
forged worker JSON, unrelated approvals, drift, quota and storage failures.
Historical completed rows retain their recorded state; they are historical
claims, not newly certified independent acceptance. Direct database edits
are outside the dispatcher contract.

Peak windows, funding routes, native model selection and failure retry
policy retain their existing owners. This change uses no banked resets and
makes no native-provider or whole-swarm readiness claim.


Queue status also reports a startup source-file fingerprint and launch UUID
only when its PID and Linux process-start token match the live heartbeat
owner. Legacy, malformed or reused-process receipts remain UNKNOWN. The
fingerprint measures the module file at startup; it is not an attestation
of every loaded dependency or a compiled executable. Compiled or unsupported
platform identities remain unknown until they have their own qualified
build/start adapter. This helps verify an upgrade without treating a moved
checkout, live PID or old metadata as deployment proof.
