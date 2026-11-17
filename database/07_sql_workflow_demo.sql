-- Run only on the local project schema (migration account, autocommit).
-- Creates new fictional demo users on each run; never deletes or resets rows.
-- Completion, comments, chat, ratings and moderation below have NO UI in this milestone.
SET @tag=REPLACE(UUID(),'-','');
SET @hash='$2b$12$M0sNED5jQtYmuqBSmGN0Cu8YSmAr45pBftff2CZYgZWrdW96CtqO.';
SET @mail_a=CONCAT('demo.a.',@tag,'@demo.campus.test');
SET @mail_b=CONCAT('demo.b.',@tag,'@demo.campus.test');
CALL sp_register(@mail_a,'SQL Demo A',@hash);
CALL sp_register(@mail_b,'SQL Demo B',@hash);
SET @a=(SELECT user_id FROM app_user WHERE campus_email=@mail_a);
SET @b=(SELECT user_id FROM app_user WHERE campus_email=@mail_b);
SET @category=(SELECT MIN(category_id) FROM category);
SELECT '1. Start: A=100 and B=100' stage,user_id,balance FROM v_account_balance WHERE user_id IN (@a,@b);
CALL sp_post_quest(@a,@category,'SQL demo: a 30 point favour','A short example to explain the ledger.',30,UTC_TIMESTAMP()+INTERVAL 1 DAY);
SET @q=(SELECT MAX(quest_id) FROM quest WHERE poster_id=@a);
SELECT '2. Reserve: A=70, escrow=30, B=100' stage,kind,user_id,quest_id,balance FROM v_account_balance WHERE user_id IN (@a,@b) OR quest_id=@q;
CALL sp_claim_quest(@b,@q);
CALL sp_send_message(@a,@q,'Shall we work through an example?');
CALL sp_send_message(@b,@q,'Yes, that would help.');
CALL sp_read_messages(@a,@q,0);
CALL sp_comment(@b,@q,'A public note about the meeting spot.');
CALL sp_submit(@b,@q,'We worked through the example and checked the result.');
SET @submission=(SELECT MAX(s.submission_id) FROM submission s JOIN claim c ON c.claim_id=s.claim_id WHERE c.quest_id=@q);
CALL sp_approve(@a,@q,@submission);
CALL sp_rate(@a,@q,5,'Clear explanation. Thank you.');
SELECT '3. Payout: A=70, escrow=0, B=130' stage,kind,user_id,quest_id,balance FROM v_account_balance WHERE user_id IN (@a,@b) OR quest_id=@q;
-- Repeating sp_approve(@a,@q,@submission) should fail, without a second payout.
-- It is intentionally not executed here so the rest of this demonstration continues.
CALL sp_post_quest(@a,@category,'SQL demo: refund branch','An unclaimed request that is no longer needed.',30,UTC_TIMESTAMP()+INTERVAL 1 DAY);
SET @refund_q=(SELECT MAX(quest_id) FROM quest WHERE poster_id=@a);
CALL sp_cancel(@a,@refund_q);
SELECT '4. Refund: A is still 70 and this escrow is zero' stage,kind,user_id,quest_id,balance FROM v_account_balance WHERE user_id=@a OR quest_id=@refund_q;
CALL sp_post_quest(@a,@category,'SQL demo: moderation branch','A fictional scope disagreement.',10,UTC_TIMESTAMP()+INTERVAL 1 DAY);
SET @dispute_q=(SELECT MAX(quest_id) FROM quest WHERE poster_id=@a);
CALL sp_claim_quest(@b,@dispute_q);
CALL sp_open_dispute(@a,@dispute_q,'The meeting was cancelled by agreement.');
SET @admin=(SELECT user_id FROM app_user WHERE campus_email='admin@demo.campus.test' AND role='ADMIN');
CALL sp_assign_dispute(@admin,@dispute_q,@admin);
CALL sp_resolve_dispute(@admin,@dispute_q,'REFUND','Both agreed that no work had begun.');
SELECT '5. Dispute refund: CANCELLED / RESOLVED' stage,q.state,d.status,d.decision FROM quest q JOIN dispute d USING(quest_id) WHERE q.quest_id=@dispute_q;
SELECT '6. Total balances must be zero' stage,SUM(balance) total FROM v_account_balance;
SELECT '7. Negative student/escrow accounts must be zero' stage,COUNT(*) invalid_accounts FROM v_account_balance WHERE kind<>'SYSTEM' AND balance<0;
