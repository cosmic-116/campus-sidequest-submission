-- MySQL 8.0.16+. Select/create your database before importing this file.
SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
SET SESSION sql_mode = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION,ONLY_FULL_GROUP_BY';
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS app_user (
  user_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  campus_email VARCHAR(254) NOT NULL UNIQUE,
  display_name VARCHAR(80) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(10) NOT NULL DEFAULT 'STUDENT',
  joined_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT ck_user_role CHECK (role IN ('STUDENT','ADMIN')),
  CONSTRAINT ck_user_text CHECK (CHAR_LENGTH(TRIM(display_name)) > 0 AND campus_email = LOWER(TRIM(campus_email)) AND campus_email LIKE '%_@_%._%')
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS skill (
  skill_id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(80) NOT NULL UNIQUE,
  CHECK (CHAR_LENGTH(TRIM(name)) > 0)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS user_skill (
  user_id BIGINT NOT NULL,
  skill_id INT NOT NULL,
  PRIMARY KEY(user_id, skill_id),
  FOREIGN KEY(user_id) REFERENCES app_user(user_id) ON DELETE CASCADE,
  FOREIGN KEY(skill_id) REFERENCES skill(skill_id) ON DELETE RESTRICT
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS category (
  category_id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(80) NOT NULL UNIQUE,
  CHECK (CHAR_LENGTH(TRIM(name)) > 0)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS quest (
  quest_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  poster_id BIGINT NOT NULL,
  category_id INT NOT NULL,
  title VARCHAR(140) NOT NULL,
  description TEXT NOT NULL,
  reward_points INT NOT NULL,
  state VARCHAR(16) NOT NULL DEFAULT 'OPEN',
  deadline DATETIME(6) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY(poster_id) REFERENCES app_user(user_id) ON DELETE RESTRICT,
  FOREIGN KEY(category_id) REFERENCES category(category_id) ON DELETE RESTRICT,
  CHECK(reward_points > 0),
  CHECK(state IN ('OPEN','CLAIMED','SUBMITTED','COMPLETED','CANCELLED')),
  CHECK(CHAR_LENGTH(TRIM(title)) > 0 AND CHAR_LENGTH(TRIM(description)) > 0),
  INDEX ix_quest_board(state, category_id, created_at),
  INDEX ix_quest_poster(poster_id, created_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS claim (
  claim_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  quest_id BIGINT NOT NULL UNIQUE,
  helper_id BIGINT NOT NULL,
  claimed_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY(quest_id) REFERENCES quest(quest_id) ON DELETE RESTRICT,
  FOREIGN KEY(helper_id) REFERENCES app_user(user_id) ON DELETE RESTRICT,
  INDEX ix_claim_helper(helper_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS submission (
  submission_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  claim_id BIGINT NOT NULL,
  evidence_text TEXT NOT NULL,
  submitted_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY(claim_id) REFERENCES claim(claim_id) ON DELETE RESTRICT,
  UNIQUE KEY uq_submission_claim(submission_id, claim_id),
  CHECK(CHAR_LENGTH(TRIM(evidence_text)) > 0),
  INDEX ix_submission_time(claim_id, submitted_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS approval (
  claim_id BIGINT PRIMARY KEY,
  submission_id BIGINT NOT NULL UNIQUE,
  approved_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY(claim_id) REFERENCES claim(claim_id) ON DELETE RESTRICT,
  FOREIGN KEY(submission_id, claim_id) REFERENCES submission(submission_id, claim_id) ON DELETE RESTRICT
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS rating (
  claim_id BIGINT PRIMARY KEY,
  score INT NOT NULL,
  comment TEXT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY(claim_id) REFERENCES approval(claim_id) ON DELETE RESTRICT,
  CHECK(score BETWEEN 1 AND 5)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS point_account (
  account_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  kind VARCHAR(16) NOT NULL,
  user_id BIGINT NULL UNIQUE,
  quest_id BIGINT NULL UNIQUE,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  system_guard TINYINT GENERATED ALWAYS AS (CASE WHEN kind='SYSTEM' THEN 1 ELSE NULL END) STORED UNIQUE,
  FOREIGN KEY(user_id) REFERENCES app_user(user_id) ON DELETE RESTRICT,
  FOREIGN KEY(quest_id) REFERENCES quest(quest_id) ON DELETE RESTRICT,
  CHECK((kind='USER' AND user_id IS NOT NULL AND quest_id IS NULL)
    OR (kind='ESCROW' AND quest_id IS NOT NULL AND user_id IS NULL)
    OR (kind='SYSTEM' AND user_id IS NULL AND quest_id IS NULL))
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS point_transfer (
  transfer_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  from_account_id BIGINT NOT NULL,
  to_account_id BIGINT NOT NULL,
  amount INT NOT NULL,
  kind VARCHAR(16) NOT NULL,
  idempotency_key VARCHAR(64) NOT NULL UNIQUE,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  grant_account BIGINT GENERATED ALWAYS AS (CASE WHEN kind='GRANT' THEN to_account_id ELSE NULL END) STORED UNIQUE,
  reserve_account BIGINT GENERATED ALWAYS AS (CASE WHEN kind='RESERVE' THEN to_account_id ELSE NULL END) STORED UNIQUE,
  settlement_account BIGINT GENERATED ALWAYS AS (CASE WHEN kind IN ('PAYOUT','REFUND') THEN from_account_id ELSE NULL END) STORED UNIQUE,
  FOREIGN KEY(from_account_id) REFERENCES point_account(account_id) ON DELETE RESTRICT,
  FOREIGN KEY(to_account_id) REFERENCES point_account(account_id) ON DELETE RESTRICT,
  CHECK(amount > 0 AND from_account_id <> to_account_id),
  CHECK(kind IN ('GRANT','RESERVE','PAYOUT','REFUND'))
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS conversation (
  conversation_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  quest_id BIGINT NOT NULL UNIQUE,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY(quest_id) REFERENCES claim(quest_id) ON DELETE RESTRICT
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS chat_message (
  message_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  conversation_id BIGINT NOT NULL,
  sender_id BIGINT NOT NULL,
  body TEXT NOT NULL,
  sent_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY(conversation_id) REFERENCES conversation(conversation_id) ON DELETE RESTRICT,
  FOREIGN KEY(sender_id) REFERENCES app_user(user_id) ON DELETE RESTRICT,
  CHECK(CHAR_LENGTH(TRIM(body)) > 0),
  INDEX ix_message_time(conversation_id, sent_at, message_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS quest_comment (
  comment_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  quest_id BIGINT NOT NULL,
  author_id BIGINT NOT NULL,
  body TEXT NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY(quest_id) REFERENCES quest(quest_id) ON DELETE RESTRICT,
  FOREIGN KEY(author_id) REFERENCES app_user(user_id) ON DELETE RESTRICT,
  CHECK(CHAR_LENGTH(TRIM(body)) > 0),
  INDEX ix_comment_time(quest_id, created_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS dispute (
  dispute_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  quest_id BIGINT NOT NULL UNIQUE,
  raised_by BIGINT NOT NULL,
  assigned_admin BIGINT NULL,
  reason TEXT NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'OPEN',
  decision VARCHAR(12) NULL,
  resolution_note TEXT NULL,
  opened_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  resolved_at DATETIME(6) NULL,
  FOREIGN KEY(quest_id) REFERENCES quest(quest_id) ON DELETE RESTRICT,
  FOREIGN KEY(raised_by) REFERENCES app_user(user_id) ON DELETE RESTRICT,
  FOREIGN KEY(assigned_admin) REFERENCES app_user(user_id) ON DELETE RESTRICT,
  CHECK(CHAR_LENGTH(TRIM(reason)) > 0),
  CHECK(status IN ('OPEN','IN_REVIEW','RESOLVED')),
  CHECK((status='RESOLVED' AND assigned_admin IS NOT NULL AND decision IS NOT NULL AND decision IN ('RESUME','REFUND')
      AND resolution_note IS NOT NULL AND CHAR_LENGTH(TRIM(resolution_note))>0 AND resolved_at IS NOT NULL)
    OR (status IN ('OPEN','IN_REVIEW') AND decision IS NULL AND resolution_note IS NULL AND resolved_at IS NULL
      AND (status='OPEN' OR assigned_admin IS NOT NULL))),
  INDEX ix_dispute_queue(status, assigned_admin)
) ENGINE=InnoDB;

INSERT INTO point_account(kind) SELECT 'SYSTEM' WHERE NOT EXISTS (SELECT 1 FROM point_account WHERE kind='SYSTEM');
