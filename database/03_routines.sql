-- These public procedures OWN their transaction. CALL them outside a transaction.
-- Internal helpers have no runtime EXECUTE grant. All timestamps use session UTC.
DELIMITER $$
DROP PROCEDURE IF EXISTS _student$$
CREATE PROCEDURE _student(IN p_actor BIGINT) SQL SECURITY DEFINER
BEGIN
  IF NOT EXISTS(SELECT 1 FROM app_user WHERE user_id=p_actor AND role='STUDENT') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='A student account is required';
  END IF;
END$$

DROP PROCEDURE IF EXISTS _move_points$$
CREATE PROCEDURE _move_points(IN p_from BIGINT, IN p_to BIGINT, IN p_amount INT, IN p_kind VARCHAR(16), IN p_key VARCHAR(64)) SQL SECURITY DEFINER
BEGIN
  DECLARE v_lock BIGINT;
  DECLARE v_balance DECIMAL(65,0);
  DECLARE v_kind VARCHAR(16);
  -- Every spending path locks both account rows in ascending ID order.
  SELECT account_id INTO v_lock FROM point_account WHERE account_id=LEAST(p_from,p_to) FOR UPDATE;
  SELECT account_id INTO v_lock FROM point_account WHERE account_id=GREATEST(p_from,p_to) FOR UPDATE;
  SELECT kind INTO v_kind FROM point_account WHERE account_id=p_from;
  SELECT COALESCE(SUM(CASE WHEN to_account_id=p_from THEN amount ELSE 0 END),0)
       - COALESCE(SUM(CASE WHEN from_account_id=p_from THEN amount ELSE 0 END),0)
    INTO v_balance FROM point_transfer WHERE to_account_id=p_from OR from_account_id=p_from;
  IF v_kind <> 'SYSTEM' AND v_balance < p_amount THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Not enough available points';
  END IF;
  INSERT INTO point_transfer(from_account_id,to_account_id,amount,kind,idempotency_key)
    VALUES(p_from,p_to,p_amount,p_kind,p_key);
END$$

DROP TRIGGER IF EXISTS validate_transfer$$
CREATE TRIGGER validate_transfer BEFORE INSERT ON point_transfer FOR EACH ROW
BEGIN
  DECLARE f_kind,t_kind VARCHAR(16);
  DECLARE f_user,t_user,qid,poster,helper BIGINT;
  DECLARE reward INT;
  SELECT kind,user_id,quest_id INTO f_kind,f_user,qid FROM point_account WHERE account_id=NEW.from_account_id;
  SELECT kind,user_id INTO t_kind,t_user FROM point_account WHERE account_id=NEW.to_account_id;
  IF NEW.kind='RESERVE' THEN
    SELECT quest_id INTO qid FROM point_account WHERE account_id=NEW.to_account_id;
  END IF;
  IF qid IS NOT NULL THEN
    SELECT poster_id,reward_points INTO poster,reward FROM quest WHERE quest_id=qid;
    SELECT helper_id INTO helper FROM claim WHERE quest_id=qid;
  END IF;
  IF NOT (
    (NEW.kind='GRANT' AND f_kind='SYSTEM' AND t_kind='USER' AND NEW.amount=100
      AND EXISTS(SELECT 1 FROM app_user WHERE user_id=t_user AND role='STUDENT')) OR
    (NEW.kind='RESERVE' AND f_kind='USER' AND t_kind='ESCROW' AND f_user=poster AND NEW.amount=reward) OR
    (NEW.kind='PAYOUT' AND f_kind='ESCROW' AND t_kind='USER' AND t_user=helper AND NEW.amount=reward) OR
    (NEW.kind='REFUND' AND f_kind='ESCROW' AND t_kind='USER' AND t_user=poster AND NEW.amount=reward)
  ) OR f_kind IS NULL OR t_kind IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Transfer does not match the workflow';
  END IF;
  -- Explicit NULL handling: SQL CHECK/IF expressions can otherwise accept UNKNOWN.
  IF NEW.kind IN ('RESERVE','PAYOUT','REFUND') AND (qid IS NULL OR poster IS NULL OR reward IS NULL
      OR (NEW.kind='PAYOUT' AND helper IS NULL)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Transfer has no matching task or helper';
  END IF;
END$$

DROP PROCEDURE IF EXISTS sp_register$$
CREATE PROCEDURE sp_register(IN p_email VARCHAR(254), IN p_name VARCHAR(80), IN p_hash VARCHAR(255)) SQL SECURITY DEFINER
BEGIN
  DECLARE uid,aid,sid BIGINT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
  SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
  START TRANSACTION;
  IF p_hash IS NULL OR CHAR_LENGTH(p_hash)<50 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='A password hash is required'; END IF;
  INSERT INTO app_user(campus_email,display_name,password_hash) VALUES(LOWER(TRIM(p_email)),TRIM(p_name),p_hash);
  SET uid=LAST_INSERT_ID();
  INSERT INTO point_account(kind,user_id) VALUES('USER',uid);
  SET aid=LAST_INSERT_ID();
  SELECT account_id INTO sid FROM point_account WHERE kind='SYSTEM';
  CALL _move_points(sid,aid,100,'GRANT',CONCAT('grant:',uid));
  COMMIT;
  SELECT uid AS user_id;
END$$

DROP PROCEDURE IF EXISTS sp_update_profile$$
CREATE PROCEDURE sp_update_profile(IN p_actor BIGINT, IN p_name VARCHAR(80), IN p_skills JSON) SQL SECURITY DEFINER
BEGIN
  DECLARE v_lock BIGINT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
  SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
  START TRANSACTION;
  CALL _student(p_actor);
  SELECT user_id INTO v_lock FROM app_user WHERE user_id=p_actor FOR UPDATE;
  IF JSON_TYPE(p_skills) <> 'ARRAY' OR p_skills IS NULL OR JSON_LENGTH(p_skills)>30 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Skills must be an array of up to 30 IDs';
  END IF;
  UPDATE app_user SET display_name=TRIM(p_name) WHERE user_id=p_actor;
  DELETE FROM user_skill WHERE user_id=p_actor;
  INSERT INTO user_skill(user_id,skill_id)
    SELECT p_actor,j.id FROM JSON_TABLE(p_skills,'$[*]' COLUMNS(id INT PATH '$' ERROR ON ERROR)) j;
  COMMIT;
END$$

DROP PROCEDURE IF EXISTS sp_post_quest$$
CREATE PROCEDURE sp_post_quest(IN p_actor BIGINT, IN p_category INT, IN p_title VARCHAR(140), IN p_description TEXT, IN p_reward INT, IN p_deadline DATETIME(6)) SQL SECURITY DEFINER
BEGIN
  DECLARE qid,src,dst BIGINT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
  SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
  START TRANSACTION;
  CALL _student(p_actor);
  IF p_deadline IS NULL OR p_deadline<=UTC_TIMESTAMP(6) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Choose a future deadline'; END IF;
  INSERT INTO quest(poster_id,category_id,title,description,reward_points,deadline)
    VALUES(p_actor,p_category,TRIM(p_title),TRIM(p_description),p_reward,p_deadline);
  SET qid=LAST_INSERT_ID();
  INSERT INTO point_account(kind,quest_id) VALUES('ESCROW',qid);
  SET dst=LAST_INSERT_ID();
  SELECT account_id INTO src FROM point_account WHERE user_id=p_actor;
  CALL _move_points(src,dst,p_reward,'RESERVE',CONCAT('reserve:',qid));
  COMMIT;
  SELECT qid AS quest_id;
END$$

DROP PROCEDURE IF EXISTS sp_claim_quest$$
CREATE PROCEDURE sp_claim_quest(IN p_actor BIGINT, IN p_quest BIGINT) SQL SECURITY DEFINER
BEGIN
  DECLARE poster,cid BIGINT DEFAULT NULL;
  DECLARE st VARCHAR(16);
  DECLARE due DATETIME(6);
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
  SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
  START TRANSACTION;
  CALL _student(p_actor);
  SELECT poster_id,state,deadline INTO poster,st,due FROM quest WHERE quest_id=p_quest FOR UPDATE;
  IF poster IS NULL OR poster=p_actor OR st<>'OPEN' OR due<=UTC_TIMESTAMP(6) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='This task cannot be accepted';
  END IF;
  INSERT INTO claim(quest_id,helper_id) VALUES(p_quest,p_actor);
  SET cid=LAST_INSERT_ID();
  INSERT INTO conversation(quest_id) VALUES(p_quest);
  UPDATE quest SET state='CLAIMED' WHERE quest_id=p_quest;
  COMMIT;
  SELECT cid AS claim_id;
END$$

DROP PROCEDURE IF EXISTS sp_submit$$
CREATE PROCEDURE sp_submit(IN p_actor BIGINT, IN p_quest BIGINT, IN p_evidence TEXT) SQL SECURITY DEFINER
BEGIN
  DECLARE st VARCHAR(16);
  DECLARE cid,helper,sid BIGINT DEFAULT NULL;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
  SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
  START TRANSACTION;
  SELECT state INTO st FROM quest WHERE quest_id=p_quest FOR UPDATE;
  SELECT claim_id,helper_id INTO cid,helper FROM claim WHERE quest_id=p_quest;
  IF p_actor IS NULL OR helper IS NULL OR helper<>p_actor OR st NOT IN ('CLAIMED','SUBMITTED') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Only the helper can submit active work'; END IF;
  INSERT INTO submission(claim_id,evidence_text) VALUES(cid,TRIM(p_evidence));
  SET sid=LAST_INSERT_ID();
  UPDATE quest SET state='SUBMITTED' WHERE quest_id=p_quest;
  COMMIT;
  SELECT sid AS submission_id;
END$$

DROP PROCEDURE IF EXISTS sp_approve$$
CREATE PROCEDURE sp_approve(IN p_actor BIGINT, IN p_quest BIGINT, IN p_submission BIGINT) SQL SECURITY DEFINER
BEGIN
  DECLARE poster,helper,cid,src,dst BIGINT DEFAULT NULL;
  DECLARE reward INT;
  DECLARE st VARCHAR(16);
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
  SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
  START TRANSACTION;
  SELECT poster_id,state,reward_points INTO poster,st,reward FROM quest WHERE quest_id=p_quest FOR UPDATE;
  IF p_actor IS NULL OR poster IS NULL OR poster<>p_actor OR st<>'SUBMITTED' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Only the requester can approve submitted work'; END IF;
  IF EXISTS(SELECT 1 FROM dispute WHERE quest_id=p_quest AND status<>'RESOLVED') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Resolve the dispute before settlement'; END IF;
  SELECT claim_id,helper_id INTO cid,helper FROM claim WHERE quest_id=p_quest;
  INSERT INTO approval(claim_id,submission_id) VALUES(cid,p_submission);
  SELECT account_id INTO src FROM point_account WHERE quest_id=p_quest;
  SELECT account_id INTO dst FROM point_account WHERE user_id=helper;
  CALL _move_points(src,dst,reward,'PAYOUT',CONCAT('payout:',p_quest));
  UPDATE quest SET state='COMPLETED' WHERE quest_id=p_quest;
  COMMIT;
END$$

DROP PROCEDURE IF EXISTS sp_cancel$$
CREATE PROCEDURE sp_cancel(IN p_actor BIGINT, IN p_quest BIGINT) SQL SECURITY DEFINER
BEGIN
  DECLARE poster,src,dst BIGINT DEFAULT NULL;
  DECLARE reward INT;
  DECLARE st VARCHAR(16);
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
  SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
  START TRANSACTION;
  SELECT poster_id,state,reward_points INTO poster,st,reward FROM quest WHERE quest_id=p_quest FOR UPDATE;
  IF p_actor IS NULL OR poster IS NULL OR poster<>p_actor OR st<>'OPEN' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Only your open tasks can be cancelled directly'; END IF;
  IF EXISTS(SELECT 1 FROM dispute WHERE quest_id=p_quest AND status<>'RESOLVED') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Resolve the dispute before settlement'; END IF;
  SELECT account_id INTO src FROM point_account WHERE quest_id=p_quest;
  SELECT account_id INTO dst FROM point_account WHERE user_id=poster;
  CALL _move_points(src,dst,reward,'REFUND',CONCAT('refund:',p_quest));
  UPDATE quest SET state='CANCELLED' WHERE quest_id=p_quest;
  COMMIT;
END$$

DROP PROCEDURE IF EXISTS sp_rate$$
CREATE PROCEDURE sp_rate(IN p_actor BIGINT, IN p_quest BIGINT, IN p_score INT, IN p_comment TEXT) SQL SECURITY DEFINER
BEGIN
  DECLARE poster,cid BIGINT DEFAULT NULL;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
  SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
  START TRANSACTION;
  SELECT poster_id INTO poster FROM quest WHERE quest_id=p_quest FOR UPDATE;
  IF p_actor IS NULL OR poster IS NULL OR poster<>p_actor THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Only the requester can rate'; END IF;
  SELECT claim_id INTO cid FROM claim WHERE quest_id=p_quest;
  INSERT INTO rating(claim_id,score,comment) VALUES(cid,p_score,p_comment);
  COMMIT;
END$$

DROP PROCEDURE IF EXISTS sp_comment$$
CREATE PROCEDURE sp_comment(IN p_actor BIGINT, IN p_quest BIGINT, IN p_body TEXT) SQL SECURITY DEFINER
BEGIN
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
  SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
  START TRANSACTION;
  CALL _student(p_actor);
  INSERT INTO quest_comment(quest_id,author_id,body) VALUES(p_quest,p_actor,TRIM(p_body));
  COMMIT;
END$$

DROP PROCEDURE IF EXISTS sp_send_message$$
CREATE PROCEDURE sp_send_message(IN p_actor BIGINT, IN p_quest BIGINT, IN p_body TEXT) SQL SECURITY DEFINER
BEGIN
  DECLARE conv BIGINT DEFAULT NULL;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
  SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
  START TRANSACTION;
  SELECT co.conversation_id INTO conv FROM conversation co
    JOIN quest q ON q.quest_id=co.quest_id JOIN claim c ON c.quest_id=q.quest_id
    WHERE q.quest_id=p_quest AND p_actor IN (q.poster_id,c.helper_id);
  IF conv IS NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Only task participants can use chat'; END IF;
  INSERT INTO chat_message(conversation_id,sender_id,body) VALUES(conv,p_actor,TRIM(p_body));
  COMMIT;
END$$

DROP PROCEDURE IF EXISTS sp_read_messages$$
CREATE PROCEDURE sp_read_messages(IN p_actor BIGINT, IN p_quest BIGINT, IN p_after BIGINT) SQL SECURITY DEFINER
BEGIN
  DECLARE conv BIGINT DEFAULT NULL;
  SELECT co.conversation_id INTO conv FROM conversation co
    JOIN quest q ON q.quest_id=co.quest_id JOIN claim c ON c.quest_id=q.quest_id
    WHERE q.quest_id=p_quest AND p_actor IN (q.poster_id,c.helper_id);
  IF conv IS NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Only task participants can use chat'; END IF;
  SELECT message_id,sender_id,body,sent_at FROM chat_message
    WHERE conversation_id=conv AND message_id>COALESCE(p_after,0) ORDER BY sent_at,message_id LIMIT 100;
END$$

DROP PROCEDURE IF EXISTS sp_open_dispute$$
CREATE PROCEDURE sp_open_dispute(IN p_actor BIGINT, IN p_quest BIGINT, IN p_reason TEXT) SQL SECURITY DEFINER
BEGIN
  DECLARE poster,helper,did BIGINT DEFAULT NULL;
  DECLARE st VARCHAR(16);
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
  SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
  START TRANSACTION;
  SELECT poster_id,state INTO poster,st FROM quest WHERE quest_id=p_quest FOR UPDATE;
  SELECT helper_id INTO helper FROM claim WHERE quest_id=p_quest;
  IF p_actor IS NULL OR poster IS NULL OR helper IS NULL OR p_actor NOT IN (poster,helper) OR st NOT IN ('CLAIMED','SUBMITTED') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Only participants in unsettled work can raise a dispute'; END IF;
  INSERT INTO dispute(quest_id,raised_by,reason) VALUES(p_quest,p_actor,TRIM(p_reason));
  SET did=LAST_INSERT_ID();
  COMMIT;
  SELECT did AS dispute_id;
END$$

DROP PROCEDURE IF EXISTS sp_assign_dispute$$
CREATE PROCEDURE sp_assign_dispute(IN p_actor BIGINT, IN p_quest BIGINT, IN p_admin BIGINT) SQL SECURITY DEFINER
BEGIN
  DECLARE poster,helper,locker BIGINT DEFAULT NULL;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
  SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
  START TRANSACTION;
  SELECT poster_id INTO poster FROM quest WHERE quest_id=p_quest FOR UPDATE;
  SELECT helper_id INTO helper FROM claim WHERE quest_id=p_quest;
  IF NOT EXISTS(SELECT 1 FROM app_user WHERE user_id=p_actor AND role='ADMIN')
    OR NOT EXISTS(SELECT 1 FROM app_user WHERE user_id=p_admin AND role='ADMIN')
    OR p_actor IN (poster,helper) OR p_admin IN (poster,helper) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='An independent admin must handle this dispute';
  END IF;
  -- Role changes by migration accounts are privileged maintenance, never a runtime feature.
  SELECT user_id INTO locker FROM app_user WHERE user_id=p_admin FOR SHARE;
  UPDATE dispute SET assigned_admin=p_admin,status='IN_REVIEW' WHERE quest_id=p_quest AND status='OPEN';
  IF ROW_COUNT()<>1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Only an open dispute can be assigned'; END IF;
  COMMIT;
END$$

DROP PROCEDURE IF EXISTS sp_resolve_dispute$$
CREATE PROCEDURE sp_resolve_dispute(IN p_actor BIGINT, IN p_quest BIGINT, IN p_decision VARCHAR(12), IN p_note TEXT) SQL SECURITY DEFINER
BEGIN
  DECLARE poster,helper,admin_id,src,dst BIGINT DEFAULT NULL;
  DECLARE reward INT;
  DECLARE st,ds VARCHAR(16);
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
  SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
  START TRANSACTION;
  SELECT poster_id,state,reward_points INTO poster,st,reward FROM quest WHERE quest_id=p_quest FOR UPDATE;
  SELECT helper_id INTO helper FROM claim WHERE quest_id=p_quest;
  SELECT assigned_admin,status INTO admin_id,ds FROM dispute WHERE quest_id=p_quest FOR UPDATE;
  IF admin_id IS NULL OR admin_id<>p_actor OR ds<>'IN_REVIEW' OR st NOT IN ('CLAIMED','SUBMITTED')
    OR p_actor IN (poster,helper) OR NOT EXISTS(SELECT 1 FROM app_user WHERE user_id=p_actor AND role='ADMIN') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Only the assigned independent admin can resolve';
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('RESUME','REFUND') OR p_note IS NULL OR CHAR_LENGTH(TRIM(p_note))=0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Choose RESUME or REFUND and write a resolution note';
  END IF;
  IF p_decision='REFUND' THEN
    SELECT account_id INTO src FROM point_account WHERE quest_id=p_quest;
    SELECT account_id INTO dst FROM point_account WHERE user_id=poster;
    CALL _move_points(src,dst,reward,'REFUND',CONCAT('refund:',p_quest));
    UPDATE quest SET state='CANCELLED' WHERE quest_id=p_quest;
  END IF;
  UPDATE dispute SET status='RESOLVED',decision=p_decision,resolution_note=TRIM(p_note),resolved_at=UTC_TIMESTAMP(6) WHERE quest_id=p_quest;
  COMMIT;
END$$

-- Private reads check the actor here as well as in the HTTP layer.
DROP PROCEDURE IF EXISTS sp_read_submissions$$
CREATE PROCEDURE sp_read_submissions(IN p_actor BIGINT, IN p_quest BIGINT, IN p_offset INT) SQL SECURITY DEFINER
BEGIN
  IF NOT EXISTS(SELECT 1 FROM quest q JOIN claim c ON c.quest_id=q.quest_id
      JOIN app_user u ON u.user_id=p_actor
      WHERE q.quest_id=p_quest AND (p_actor IN (q.poster_id,c.helper_id) OR u.role='ADMIN')) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Only participants or admins can read work summaries';
  END IF;
  SELECT s.submission_id,s.evidence_text,s.submitted_at,a.approved_at
  FROM submission s JOIN claim c ON c.claim_id=s.claim_id
  LEFT JOIN approval a ON a.submission_id=s.submission_id
  WHERE c.quest_id=p_quest ORDER BY s.submission_id DESC LIMIT 20 OFFSET p_offset;
END$$

DROP PROCEDURE IF EXISTS sp_read_disputes$$
CREATE PROCEDURE sp_read_disputes(IN p_actor BIGINT, IN p_quest BIGINT, IN p_offset INT) SQL SECURITY DEFINER
BEGIN
  IF NOT EXISTS(SELECT 1 FROM app_user WHERE user_id=p_actor) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Please log in first';
  END IF;
  IF p_quest IS NULL AND NOT EXISTS(SELECT 1 FROM app_user WHERE user_id=p_actor AND role='ADMIN') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Only admins can read the dispute queue';
  END IF;
  IF p_quest IS NOT NULL AND NOT EXISTS(SELECT 1 FROM quest q JOIN claim c ON c.quest_id=q.quest_id
      JOIN app_user u ON u.user_id=p_actor
      WHERE q.quest_id=p_quest AND (p_actor IN (q.poster_id,c.helper_id) OR u.role='ADMIN')) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Only participants or admins can read this dispute';
  END IF;
  SELECT d.*,q.title,u.display_name AS raised_name,a.display_name AS admin_name
  FROM dispute d JOIN quest q ON q.quest_id=d.quest_id
  JOIN app_user u ON u.user_id=d.raised_by LEFT JOIN app_user a ON a.user_id=d.assigned_admin
  WHERE p_quest IS NULL OR d.quest_id=p_quest
  ORDER BY FIELD(d.status,'OPEN','IN_REVIEW','RESOLVED'),d.dispute_id DESC LIMIT 20 OFFSET p_offset;
END$$

DROP PROCEDURE IF EXISTS sp_read_wallet$$
CREATE PROCEDURE sp_read_wallet(IN p_actor BIGINT, IN p_offset INT) SQL SECURITY DEFINER
BEGIN
  CALL _student(p_actor);
  SELECT t.transfer_id,t.kind,t.created_at,
    CASE WHEN t.to_account_id=a.account_id THEN t.amount ELSE -t.amount END AS points,
    q.quest_id,q.title
  FROM point_account a JOIN point_transfer t ON a.account_id IN (t.from_account_id,t.to_account_id)
  JOIN point_account other ON other.account_id=CASE WHEN t.from_account_id=a.account_id THEN t.to_account_id ELSE t.from_account_id END
  LEFT JOIN quest q ON q.quest_id=other.quest_id
  WHERE a.user_id=p_actor ORDER BY t.transfer_id DESC LIMIT 20 OFFSET p_offset;
END$$
DELIMITER ;
