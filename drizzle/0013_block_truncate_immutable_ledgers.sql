-- Row-level triggers don't fire on TRUNCATE. Block it on the append-only
-- tables too (payment ledger, board votes) with statement-level triggers.
CREATE TRIGGER payment_events_no_truncate BEFORE TRUNCATE ON "payment_events"
  FOR EACH STATEMENT EXECUTE FUNCTION payment_events_immutable();--> statement-breakpoint
CREATE TRIGGER board_votes_no_truncate BEFORE TRUNCATE ON "board_votes"
  FOR EACH STATEMENT EXECUTE FUNCTION board_votes_immutable();
