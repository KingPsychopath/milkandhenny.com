# Event scoring operations

Event scoring is an optional event layer. Games publish an official result to an opaque channel. They do not import the scoring ledger, know point values, or write balances. Events with no active binding keep the existing game path and cost.

## Policy

- Points apply to one event only. They have no cash value.
- A refund or void keeps admission and score history, blocks new awards, and follows the event ranking policy. A transfer after points exist needs an identity review. Points do not move automatically.
- A closed event accepts only a confirmed admin correction with a note. The board becomes provisional until it is finalized again.
- Team attribution is fixed when an award is posted. Moving old team points needs an explicit correction.
- Static QRs prove possession only. Valuable claims must use a short window, rotation, or staff confirmation.
- Prize terms must state eligibility, ties, the tie-break process, and the correction deadline before publication.

## Retention and privacy

- Ledger postings, admission records, identity merge evidence, and audit events are retained with the event record because they explain the published result.
- Anonymous attendee sessions expire after 60 days. Staff and discovery credentials have an explicit expiry or remain revocable.
- Event media expires with its transfer unless an admin promotes it to a durable album. A deleted media link does not edit its score transaction.
- Exports are admin-only, require step-up authorization, and omit bearer credentials.
- A privacy request pseudonymizes the person and public alias. It does not delete immutable score, admission, or audit rows.

## Event closeout

1. Freeze scoring and review held game results and discovery claims.
2. Resolve reversals, penalties, identity merges, and disputed team attribution.
3. Rebuild projections and compare the balance and revision summary.
4. Close scoring, resolve prize ties, and finalize the board.
5. Download the safe scoring export and required print or control records.
6. Reclaim unused staff and activity pools. Revoke staff devices and links.
7. Confirm the event media expiry. Promote only selected consented files.

## Recovery and monitoring

Postgres backup and restore includes the immutable ledger, people, participants, links, and audit data. After a restore, run the projection rebuild and compare its participant count, revision, and balances before publication.

Production logs must alert on repeated score-write failure, held-action growth, projection drift, pool exhaustion, session-store failure, discovery rejection spikes, and media processing failure. Log event, action, status, actor class, assignment or station, and revision. Do not log ticket credentials, staff tokens, discovery secrets, email addresses, or private notes.
