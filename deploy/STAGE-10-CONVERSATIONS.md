# Stage 10: conversations about student work

This is a deployment note only. Stage 10 is not deployed by Codex.

The release adds the additive migration `009_work_conversations.sql`. It
creates `conversation_threads` and `conversation_messages`; it does not drop or
rewrite authentication, learning, submission, test, material or audit tables.
Existing non-empty homework/mock `student_comment` and `teacher_comment` values
are copied into immutable conversation history with deterministic legacy keys.
The inserts are idempotent.

Deployment must follow the existing clean-release and backup process:

1. back up PostgreSQL and the current frontend/backend;
2. install the reviewed backend and frontend files without overwriting `.env`,
   `privacy.html` or `offer.html`;
3. run `npm ci` in the protected backend directory;
4. run `npm run migrate` and `npm run schema:status`;
5. restart `social-ege.service` and use retrying health checks.

No new environment variables, storage directories, Nginx rules or systemd
permissions are required.

After deployment, verify student/admin IDOR boundaries for all three subject
types, unread/read transitions, Inbox navigation, reply history, a resubmitted
homework/mock, and a specific test-attempt conversation. Do not use real
student records for smoke tests.
