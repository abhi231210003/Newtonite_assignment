# Engineering Decisions

## 1. Data model: work items, history, comments, and async tasks
I chose a relational SQLite schema for fast reads and explicit auditing. Work items are the primary record, while item history and comments provide a trustworthy trail of change rather than a purely UI-driven log. This supports the challenge requirement that important actions should not silently disappear and makes it simpler to reason about ownership, approvals, and concurrency.

## 2. Authorization in the backend, not only the UI
Users are assigned roles such as admin, team lead, analyst, and viewer. The API enforces permissions before mutating a work item, including rejecting viewer attempts to create work items. The UI hides unavailable controls for clarity, but the API remains the security boundary. This matters because the challenge explicitly calls out that authorization cannot rely on hiding controls in the frontend.

## 3. Optimistic concurrency with version checking
When a user edits a work item, the client provides the version seen during loading. The server compares that version to the current version and rejects stale updates with a 409 response. This is a lightweight but meaningful way to handle concurrent usage and avoid overwriting someone else's work without notice.

## 4. Asynchronous processing for secondary work
I introduced a lightweight async task queue for post-action processing like notifications or downstream enrichment. The primary update is still committed synchronously, while the task is processed later. Each task has an explicit queued, completed, or failed state and the activity history records successful processing. This mirrors the requirement that some actions are not strictly synchronous and helps avoid user-facing delay for low-risk follow-up steps. Durable retry scheduling and a distributed worker are known follow-up work.

## 5. Intentional scope and trade-offs
This version prioritizes a coherent, testable MVP rather than a distributed or enterprise-scale platform. The browser uses a focused operations board with three practical views: all work, the signed-in user's queue, and approval-required work. Users have one primary team in this version; a normalized membership table would support the brief's multi-team identity model in a larger iteration. I intentionally did not build a full real-time collaborative system or large-scale queue infrastructure; users refresh after server decisions, while version checks protect against silent overwrites. This keeps the workflow understandable without pretending to solve every distributed-systems problem.
