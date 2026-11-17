import { safeDatabase } from './setup.js';
export async function applyPermissions(c, db) {
  safeDatabase(db);
  for (const view of ['v_account_balance','v_quest_summary','v_student_rating','v_leaderboard','v_public_comment','v_public_rating']) {
    await c.query(`GRANT SELECT ON \`${db}\`.${view} TO 'csq_runtime_role', 'csq_report_role'`);
  }
  for (const table of ['skill','category','user_skill']) await c.query(`GRANT SELECT ON \`${db}\`.${table} TO 'csq_runtime_role'`);
  await c.query(`GRANT SELECT(user_id,campus_email,display_name,password_hash,role,joined_at) ON \`${db}\`.app_user TO 'csq_runtime_role'`);
  for (const proc of ['register','update_profile','post_quest','claim_quest','submit','approve','cancel','rate','comment','send_message','read_messages','read_submissions','read_disputes','read_wallet','open_dispute','assign_dispute','resolve_dispute']) {
    await c.query(`GRANT EXECUTE ON PROCEDURE \`${db}\`.sp_${proc} TO 'csq_runtime_role'`);
  }
}
