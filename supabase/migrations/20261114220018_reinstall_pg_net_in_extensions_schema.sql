-- Re-register pg_net outside public to clear the extension_in_public advisor finding.
-- DROP without CASCADE is intentional: abort if any unexpected dependency exists.
-- Dropping pg_net also removes its managed net schema in this project/version.
DROP EXTENSION pg_net;
CREATE EXTENSION pg_net WITH SCHEMA extensions;
