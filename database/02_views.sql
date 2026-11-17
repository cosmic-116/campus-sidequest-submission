-- Aggregate each many-side separately; never join raw transfers to raw ratings.
CREATE OR REPLACE SQL SECURITY DEFINER VIEW v_account_balance AS
SELECT a.account_id, a.kind, a.user_id, a.quest_id,
  COALESCE(i.points,0) - COALESCE(o.points,0) AS balance
FROM point_account a
LEFT JOIN (SELECT to_account_id, SUM(amount) points FROM point_transfer GROUP BY to_account_id) i ON i.to_account_id=a.account_id
LEFT JOIN (SELECT from_account_id, SUM(amount) points FROM point_transfer GROUP BY from_account_id) o ON o.from_account_id=a.account_id;

CREATE OR REPLACE SQL SECURITY DEFINER VIEW v_student_rating AS
SELECT u.user_id, u.display_name, COUNT(r.claim_id) rating_count, AVG(r.score) average_score
FROM app_user u LEFT JOIN claim c ON c.helper_id=u.user_id
LEFT JOIN rating r ON r.claim_id=c.claim_id
WHERE u.role='STUDENT' GROUP BY u.user_id,u.display_name;

CREATE OR REPLACE SQL SECURITY DEFINER VIEW v_quest_summary AS
SELECT q.*, u.display_name AS poster_name, cat.name AS category_name,
 c.claim_id,c.helper_id,h.display_name AS helper_name
FROM quest q JOIN app_user u ON u.user_id=q.poster_id
JOIN category cat ON cat.category_id=q.category_id
LEFT JOIN claim c ON c.quest_id=q.quest_id
LEFT JOIN app_user h ON h.user_id=c.helper_id;

CREATE OR REPLACE SQL SECURITY DEFINER VIEW v_leaderboard AS
SELECT u.user_id,u.display_name,COALESCE(p.earned_points,0) earned_points,
 COALESCE(p.completed_count,0) completed_count,r.rating_count,r.average_score
FROM app_user u
JOIN v_student_rating r ON r.user_id=u.user_id
LEFT JOIN (SELECT a.user_id,SUM(t.amount) earned_points,COUNT(*) completed_count
 FROM point_account a JOIN point_transfer t ON t.to_account_id=a.account_id AND t.kind='PAYOUT'
 GROUP BY a.user_id) p ON p.user_id=u.user_id
WHERE u.role='STUDENT';

CREATE OR REPLACE SQL SECURITY DEFINER VIEW v_public_comment AS
SELECT c.comment_id,c.quest_id,c.body,c.created_at,u.display_name AS author_name
FROM quest_comment c JOIN app_user u ON u.user_id=c.author_id;

CREATE OR REPLACE SQL SECURITY DEFINER VIEW v_public_rating AS
SELECT c.quest_id,r.score,r.comment,r.created_at
FROM rating r JOIN claim c ON c.claim_id=r.claim_id;
