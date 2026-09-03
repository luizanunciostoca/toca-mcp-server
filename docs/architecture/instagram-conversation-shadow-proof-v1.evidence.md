# Conversation Shadow Proof Evidence

The executable proof emits a single sanitized JSON record with validation key `instagram-conversation-shadow-e2e`.

PASS requires all of the following:

- grouping inbound events = 2;
- persisted groups = 1;
- decisions = 1;
- grouped message count = 2;
- LOW confidence observed with no auto-send;
- P0 action status = HUMAN_REVIEW;
- P0 thread state = ESCALATED;
- reply outbox events = 0;
- external reply observed = false;
- writes enabled = false;
- message text, user identity and secrets are not printed.
