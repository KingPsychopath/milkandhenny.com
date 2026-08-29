# Postmortem: Idle Media Worker Redis Command Spike

## Incident

On 29 August 2026, Upstash warned that `guestlist-kv` had used 450,061 of its
500,000 monthly free-tier commands. The database held only 96 keys and the
media queues were empty, so product traffic could not explain the usage.

## Impact

- The Redis database reached 90% of its monthly quota before launch.
- Exhausting the quota would have interrupted every feature using Redis, not
  just media processing.
- The worker had processed no media since 1 August but continued consuming
  commands around the clock.

## Root cause

The long-running media worker reused a finite CLI drain primitive:

1. Two consumers each requested a blocking claim with a 10-second timeout.
2. Both consumers shared one blocking Redis connection, so their claims ran
   serially rather than concurrently.
3. Once both empty claims returned, the outer loop immediately started another
   drain pass and forced a heartbeat write.

That produced roughly one claim every 10 seconds plus one heartbeat every 20
seconds: about 388,800 commands in a 30-day month before reconciliation or real
application traffic.

## Containment

The web service was switched to `MEDIA_PROCESSOR_MODE=local` and successfully
redeployed before the media-worker deployment was stopped. New uploads
therefore continued to process inline and no queue was left without a consumer.

## Permanent correction

- The long-running worker now gives each concurrency slot a dedicated direct
  Redis connection with an indefinite blocking claim.
- Queue idleness produces no repeated queue commands.
- Shutdown aborts idle blocking connections while allowing an already claimed
  job to finish, acknowledge, or requeue through the command connection.
- Heartbeats run independently every five minutes by default.
- Reconciliation runs independently every 15 minutes by default.
- Reconciliation also requeues only expired processing leases, so a job from a
  crashed worker is recovered without waiting for another deployment.
- The finite drain command still exits when idle, but also uses a dedicated
  connection per concurrency slot so configured concurrency is real.
- JWT revocation and token-version validation use one `MGET`, which Upstash
  bills as a single command.
- Ordinary attendee-session access is one `GET`. Expiry is extended by the
  existing weekly session rotation and every durable session mutation instead
  of an extra write on every read.

## Regression guards

- A unit test proves that a two-slot idle worker creates two distinct clients,
  makes exactly one indefinite claim on each, and stops without another claim.
- Operational documentation describes the expected idle command model and
  heartbeat interval.
- Deployment verification samples Redis command counts after startup and checks
  that an empty queue remains empty without time-proportional command growth.

## Lesson

A blocking queue command is cheap only when it is allowed to remain blocked.
Finite blocking timeouts are polling, and concurrent blocking consumers cannot
share a connection. Long-running workers and one-shot drain commands need
separate lifecycle semantics even when they share job-processing code.
