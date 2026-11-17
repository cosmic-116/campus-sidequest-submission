-- Run the SELECT section as migration or reporting where its view grants permit.
-- Select your project schema first: USE campus_sidequest;
-- INNER JOIN: category and requester for open requests.
SELECT q.quest_id,q.title,u.display_name,cat.name
FROM quest q JOIN app_user u ON u.user_id=q.poster_id
JOIN category cat ON cat.category_id=q.category_id WHERE q.state='OPEN';
-- LEFT JOIN: show unclaimed requests as well.
SELECT q.title,helper.display_name AS helper
FROM quest q LEFT JOIN claim c ON c.quest_id=q.quest_id
LEFT JOIN app_user helper ON helper.user_id=c.helper_id;
-- GROUP BY + HAVING: categories with at least two requests.
SELECT cat.name,COUNT(*) requests FROM quest q JOIN category cat USING(category_id)
GROUP BY cat.category_id,cat.name HAVING COUNT(*)>=2;
-- Subquery: rewards above the average offer (all states).
SELECT title,reward_points FROM quest WHERE reward_points>(SELECT AVG(reward_points) FROM quest);
-- Filtering and ordered pagination; application binds values instead of literals.
SELECT * FROM v_quest_summary WHERE state='OPEN' AND category_id=1
ORDER BY created_at DESC,quest_id DESC LIMIT 6 OFFSET 0;
SELECT * FROM v_account_balance ORDER BY account_id;
SELECT * FROM v_student_rating ORDER BY user_id;
SELECT * FROM v_leaderboard ORDER BY earned_points DESC,user_id;
-- Wallet SQL is ready; dedicated wallet HTTP routes are deferred.
SET @student=(SELECT user_id FROM app_user WHERE campus_email='prince@demo.campus.test');
SELECT t.transfer_id,t.kind,t.amount,t.created_at,
  CASE WHEN a.account_id=t.to_account_id THEN 'IN' ELSE 'OUT' END direction
FROM point_account a JOIN point_transfer t ON a.account_id IN (t.from_account_id,t.to_account_id)
WHERE a.user_id=@student ORDER BY t.created_at,t.transfer_id;
-- Public comments; chat intentionally uses sp_read_messages(actor, quest, after_id).
SELECT qc.body,qc.created_at,u.display_name FROM quest_comment qc
JOIN app_user u ON u.user_id=qc.author_id ORDER BY qc.created_at;
-- Financial invariants: first two return no rows, final value is zero.
SELECT * FROM v_account_balance WHERE kind<>'SYSTEM' AND balance<0;
SELECT from_account_id FROM point_transfer WHERE kind IN ('PAYOUT','REFUND')
GROUP BY from_account_id HAVING COUNT(*)>1;
SELECT SUM(balance) AS total_should_be_zero FROM v_account_balance;
EXPLAIN SELECT * FROM quest WHERE state='OPEN' AND category_id=1 ORDER BY created_at DESC LIMIT 6;
EXPLAIN SELECT * FROM chat_message WHERE conversation_id=1 ORDER BY sent_at,message_id LIMIT 100;

-- DML exercise, rolled back. Use migration in a separate Workbench tab.
START TRANSACTION;
INSERT INTO skill(name) VALUES('Example skill for viva');
UPDATE skill SET name='Revised example skill for viva' WHERE name='Example skill for viva';
DELETE FROM skill WHERE name='Revised example skill for viva';
ROLLBACK;
-- DDL example using a TEMPORARY table: not a persistent business entity.
CREATE TEMPORARY TABLE demo_state_counts AS SELECT state,COUNT(*) n FROM quest GROUP BY state;
SELECT * FROM demo_state_counts;
DROP TEMPORARY TABLE demo_state_counts;
-- DCL GRANT/REVOKE exercise is in 05_permissions.example.sql.
