-- Bootstrap ONCE as a local DBA; replace the three example passwords first.
-- Do not import on unrelated instances. The web app NEVER uses this DBA login.
-- For the isolated Windows instance, local:init performs equivalent commands with random secrets.
CREATE DATABASE IF NOT EXISTS campus_sidequest CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE IF NOT EXISTS campus_sidequest_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE ROLE IF NOT EXISTS 'csq_runtime_role', 'csq_report_role';
CREATE USER IF NOT EXISTS 'csq_migration'@'localhost' IDENTIFIED BY 'CHANGE_ME_migration_2026!';
CREATE USER IF NOT EXISTS 'csq_runtime'@'localhost' IDENTIFIED BY 'CHANGE_ME_runtime_2026!';
CREATE USER IF NOT EXISTS 'csq_report'@'localhost' IDENTIFIED BY 'CHANGE_ME_report_2026!';
-- A schema-scoped migration/admin account, separate from runtime/reporting roles.
GRANT ALL PRIVILEGES ON campus_sidequest.* TO 'csq_migration'@'localhost' WITH GRANT OPTION;
GRANT ALL PRIVILEGES ON campus_sidequest_test.* TO 'csq_migration'@'localhost' WITH GRANT OPTION;
GRANT 'csq_runtime_role' TO 'csq_runtime'@'localhost';
GRANT 'csq_report_role' TO 'csq_report'@'localhost';
SET DEFAULT ROLE 'csq_runtime_role' TO 'csq_runtime'@'localhost';
SET DEFAULT ROLE 'csq_report_role' TO 'csq_report'@'localhost';
-- Now run npm run db:setup as csq_migration. scripts/permissions.js grants SELECT
-- on approved views/catalog, credential reads to runtime, and only public sp_* CALLs.
-- It reapplies per-routine grants after each DROP/CREATE, including safe reruns.
-- Do not GRANT EXECUTE ON database.*: that would expose internal _move_points.

-- After setup, run this safe DCL exercise as migration/DBA (no sensitive reads):
GRANT SELECT ON campus_sidequest.category TO 'csq_report_role';
REVOKE SELECT ON campus_sidequest.category FROM 'csq_report_role';
-- Reporting keeps its safe view grants; it has no password/chat/base-table access.
SHOW GRANTS FOR 'csq_runtime_role';
SHOW GRANTS FOR 'csq_report_role';
-- If your existing server uses binary logs, have its DBA review trigger creation
-- privileges. Do not change server settings blindly. The isolated demo uses --skip-log-bin.
