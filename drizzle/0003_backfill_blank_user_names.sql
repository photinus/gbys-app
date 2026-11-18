-- Backfill display names for magic-link users created before the auth hook
-- defaulted blank names to the email's local part.
UPDATE "users"
SET "name" = COALESCE(NULLIF(split_part("email", '@', 1), ''), 'Volunteer')
WHERE btrim("name") = '';
