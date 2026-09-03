# Instagram Conversation Shadow Proof v1

Status: candidate until merged.

This proof extends the existing Instagram engagement shadow validation without enabling external replies.

It verifies, against the deployed shadow runtime and PostgreSQL evidence, that:

- two nearby DIRECT messages from the same sender are coalesced into one persistent message group;
- the two-message group produces exactly one engagement action/decision;
- a LOW-confidence unknown material question never reaches READY_TO_SEND or SENT;
- a P0 harassment/threat message produces HUMAN_REVIEW and an ESCALATED thread;
- no `instagram.engagement.reply.v1` outbox event is created for any proof event;
- no provider reply ID is observed;
- `INSTAGRAM_ENGAGEMENT_WRITES_ENABLED` must remain false for the proof to run.

The proof uses unique synthetic sender/message IDs and never prints message text, user identity, database credentials, application secrets, or provider tokens in its PASS evidence.
