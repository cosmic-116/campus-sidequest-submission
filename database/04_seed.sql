-- Fictional student demo. Shared demo password: CampusDemo!2026
-- Six OPEN requests keep the board small; five history rows demonstrate SQL states.
-- Safe rerun preserves fixtures; the two spelling corrections below keep user IDs.
DELIMITER $$
DROP PROCEDURE IF EXISTS sp_seed_demo$$
CREATE PROCEDURE sp_seed_demo()
BEGIN
  DECLARE prince,jayant,dhruv,siddhanth,admin1,admin2,q,sid BIGINT;
  DECLARE study,tech,borrow,practice,campus INT;
  DECLARE h VARCHAR(255) DEFAULT '$2b$12$M0sNED5jQtYmuqBSmGN0Cu8YSmAr45pBftff2CZYgZWrdW96CtqO.';
  IF NOT EXISTS(SELECT 1 FROM app_user WHERE campus_email='prince@demo.campus.test') THEN
    INSERT IGNORE INTO skill(name) VALUES('SQL'),('Python'),('Database design'),('Public speaking'),('Writing');
    INSERT IGNORE INTO category(name) VALUES('Study help'),('Tech help'),('Borrow & share'),('Practice together'),('Around campus');
    SELECT category_id INTO study FROM category WHERE name='Study help';
    SELECT category_id INTO tech FROM category WHERE name='Tech help';
    SELECT category_id INTO borrow FROM category WHERE name='Borrow & share';
    SELECT category_id INTO practice FROM category WHERE name='Practice together';
    SELECT category_id INTO campus FROM category WHERE name='Around campus';

    CALL sp_register('prince@demo.campus.test','Prince',h);
    SELECT user_id INTO prince FROM app_user WHERE campus_email='prince@demo.campus.test';
    CALL sp_register('jayant@demo.campus.test','Jayant',h);
    SELECT user_id INTO jayant FROM app_user WHERE campus_email='jayant@demo.campus.test';
    CALL sp_register('dhruv@demo.campus.test','Dhruv',h);
    SELECT user_id INTO dhruv FROM app_user WHERE campus_email='dhruv@demo.campus.test';
    CALL sp_register('siddhanth@demo.campus.test','Siddhanth',h);
    SELECT user_id INTO siddhanth FROM app_user WHERE campus_email='siddhanth@demo.campus.test';
    INSERT INTO app_user(campus_email,display_name,password_hash,role)
      VALUES('admin@demo.campus.test','Demo Admin',h,'ADMIN');
    SET admin1=LAST_INSERT_ID();
    INSERT INTO app_user(campus_email,display_name,password_hash,role)
      VALUES('review@demo.campus.test','Review Admin',h,'ADMIN');
    SET admin2=LAST_INSERT_ID();
    INSERT INTO user_skill SELECT prince,skill_id FROM skill WHERE name IN ('SQL','Database design');
    INSERT INTO user_skill SELECT jayant,skill_id FROM skill WHERE name IN ('SQL','Python');
    INSERT INTO user_skill SELECT dhruv,skill_id FROM skill WHERE name IN ('Public speaking','Writing');
    INSERT INTO user_skill SELECT siddhanth,skill_id FROM skill WHERE name IN ('Database design','Public speaking');

    -- Completed work uses the same atomic approval/payout path as the SQL demo.
    CALL sp_post_quest(prince,study,'Walk through a transaction rollback example',
      'I want to understand why both updates must roll back when one step fails. Let us trace a small points-transfer example in the lab.',
      30,UTC_TIMESTAMP()+INTERVAL 14 DAY);
    SELECT quest_id INTO q FROM quest WHERE poster_id=prince AND title='Walk through a transaction rollback example';
    CALL sp_claim_quest(jayant,q);
    CALL sp_send_message(prince,q,'Can we use a failed transfer as the example?');
    CALL sp_send_message(jayant,q,'Yes, we can compare the balances before and after ROLLBACK.');
    CALL sp_comment(dhruv,q,'The lab whiteboard is available after class.');
    CALL sp_submit(jayant,q,'We traced a failed transfer and checked that neither balance changed after rollback.');
    SELECT s.submission_id INTO sid FROM submission s JOIN claim c ON c.claim_id=s.claim_id
      WHERE c.quest_id=q ORDER BY s.submission_id DESC LIMIT 1;
    CALL sp_approve(prince,q,sid);
    CALL sp_rate(prince,q,5,'The before-and-after example made the transaction boundary clear.');

    -- Small history set for the SQL-only workflows and all lifecycle states.
    CALL sp_post_quest(dhruv,tech,'Trace a Python loop before the lab',
      'Help me spot why my loop skips an item, then explain the correction using a short example.',
      10,UTC_TIMESTAMP()+INTERVAL 15 DAY);
    SELECT quest_id INTO q FROM quest WHERE poster_id=dhruv AND title='Trace a Python loop before the lab';
    CALL sp_claim_quest(siddhanth,q);
    CALL sp_open_dispute(dhruv,q,'We need to agree whether the request covers explaining the bug or rewriting the exercise.');

    CALL sp_post_quest(siddhanth,study,'Check the keys in a sample schema',
      'Review the primary and foreign keys in my sample library schema and explain any missing reference.',
      12,UTC_TIMESTAMP()+INTERVAL 16 DAY);
    SELECT quest_id INTO q FROM quest WHERE poster_id=siddhanth AND title='Check the keys in a sample schema';
    CALL sp_claim_quest(prince,q);
    CALL sp_submit(prince,q,'Marked a missing book reference and checked the composite key in the borrowing relation.');
    CALL sp_open_dispute(siddhanth,q,'We need to clarify one proposed key change before approval.');
    CALL sp_assign_dispute(admin1,q,admin1);

    CALL sp_post_quest(jayant,campus,'Carry display boards to the classroom',
      'Help carry two lightweight display boards from the lab to the classroom before our presentation.',
      10,UTC_TIMESTAMP()+INTERVAL 17 DAY);
    SELECT quest_id INTO q FROM quest WHERE poster_id=jayant AND title='Carry display boards to the classroom';
    CALL sp_claim_quest(dhruv,q);
    CALL sp_open_dispute(jayant,q,'The presentation moved online before any work began.');
    CALL sp_assign_dispute(admin2,q,admin2);
    CALL sp_resolve_dispute(admin2,q,'REFUND','Both students confirmed no work was needed after the venue change.');

    CALL sp_post_quest(siddhanth,practice,'Rehearse a five-minute project explanation',
      'Listen to a short explanation of our database and flag any parts that are hard to follow.',
      10,UTC_TIMESTAMP()+INTERVAL 18 DAY);
    SELECT quest_id INTO q FROM quest WHERE poster_id=siddhanth AND title='Rehearse a five-minute project explanation';
    CALL sp_claim_quest(dhruv,q);
    CALL sp_open_dispute(dhruv,q,'Our original practice time clashes with a lab session.');
    CALL sp_assign_dispute(admin1,q,admin1);
    CALL sp_resolve_dispute(admin1,q,'RESUME','Both agreed to rehearse after the lab; the original task remains claimed.');

    -- The six requests visible on the default OPEN board.
    CALL sp_post_quest(prince,study,'Check the relationships in our ER diagram',
      'I have drawn a campus task-board diagram and want a second check of the cardinalities and foreign keys. Bring one example of a many-to-many relationship; we can compare it in the library.',
      15,UTC_TIMESTAMP()+INTERVAL 7 DAY);
    CALL sp_post_quest(jayant,tech,'Debug a MySQL JOIN that repeats rows',
      'My query joins two one-to-many tables and the totals look too large. Help me understand the repeated rows and check one corrected query in the lab.',
      20,UTC_TIMESTAMP()+INTERVAL 8 DAY);
    CALL sp_post_quest(dhruv,practice,'Practise DBMS viva questions together',
      'Looking for a 20-minute practice partner for keys, normalisation and transactions. We can take turns asking questions after class.',
      10,UTC_TIMESTAMP()+INTERVAL 9 DAY);
    CALL sp_post_quest(siddhanth,borrow,'Borrow a scientific calculator for practice',
      'I need a scientific calculator for a 45-minute practice session in the library. I will return it before leaving the library.',
      5,UTC_TIMESTAMP()+INTERVAL 10 DAY);
    CALL sp_post_quest(prince,tech,'Review a query plan with EXPLAIN',
      'Help me read one MySQL EXPLAIN result and understand why an index is or is not selected. I have a small sample table ready so we can test it together.',
      15,UTC_TIMESTAMP()+INTERVAL 11 DAY);
    CALL sp_post_quest(jayant,study,'Share your normalisation revision notes',
      'Could we compare one example each of partial and transitive dependencies before the quiz? Your own brief notes are enough; I will bring my examples too.',
      10,UTC_TIMESTAMP()+INTERVAL 12 DAY);
  END IF;
  UPDATE app_user SET display_name='Dhruv',campus_email='dhruv@demo.campus.test'
    WHERE campus_email='dhrubv@demo.campus.test' AND display_name='Dhrubv';
  UPDATE app_user SET display_name='Siddhanth',campus_email='siddhanth@demo.campus.test'
    WHERE campus_email='suddhanth@demo.campus.test' AND display_name='Suddhanth';
END$$
CALL sp_seed_demo()$$
DROP PROCEDURE sp_seed_demo$$
DELIMITER ;
