import { test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import { call,createPool } from '../src/db.js';
import { importSQL } from '../scripts/sql.js';
import { setup } from '../scripts/setup.js';
import { prepare,student,admin,post,submitted,balance,count,rejected,invariants,hash,future } from './helpers.js';
let db,runtime,dcl;
before(async()=>{
  ({db,runtime,dcl}=await prepare());
  await db.query("INSERT INTO category(name) VALUES('Study help'),('Tech help')");
  await db.query("INSERT INTO skill(name) VALUES('SQL'),('Writing')");
});
after(async()=>{await db?.end();await runtime?.end();});

test('15 canonical tables, core keys, checks and FK count',async()=>{
  const [tables]=await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_type='BASE TABLE'");
  assert.deepEqual(tables.map(x=>x.TABLE_NAME).sort(),['app_user','skill','user_skill','category','quest','claim','submission','approval','rating','point_account','point_transfer','conversation','chat_message','quest_comment','dispute'].sort());
  const [[row]]=await db.query("SELECT COUNT(*) n FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND constraint_type='CHECK'");assert.ok(Number(row.n)>=15);
  const [[fk]]=await db.query("SELECT COUNT(*) n FROM information_schema.referential_constraints WHERE constraint_schema=DATABASE()");assert.equal(Number(fk.n),22);
});
test('UNIQUE, FK, CHECK and SYSTEM singleton reject invalid rows',async()=>{
  const a=await student(db);
  const [[user]]=await db.execute('SELECT campus_email FROM app_user WHERE user_id=?',[a]);
  await rejected(call(db,'sp_register',[user.campus_email.toUpperCase(),'Duplicate',hash]));
  await rejected(db.query("INSERT INTO skill(name) VALUES('sql')"));
  await rejected(post(db,a,0));
  await rejected(call(db,'sp_post_quest',[a,9999,'Bad FK','Description',10,future()]));
  await rejected(db.query("INSERT INTO point_account(kind) VALUES('SYSTEM')"));
  await rejected(db.query("INSERT INTO point_account(kind,user_id) VALUES('ESCROW',?)",[a]));
});
test('registration grants exactly once; failed grant rolls back user and account',async()=>{
  const a=await student(db);assert.equal(await balance(db,a),100);
  const [[account]]=await db.execute('SELECT account_id FROM point_account WHERE user_id=?',[a]);
  const [[system]]=await db.query("SELECT account_id FROM point_account WHERE kind='SYSTEM'");
  await rejected(db.execute("INSERT INTO point_transfer(from_account_id,to_account_id,amount,kind,idempotency_key) VALUES(?,?,100,'GRANT','different-key')",[system.account_id,account.account_id]));
  const before=[await count(db,'app_user'),await count(db,'point_account'),await count(db,'point_transfer')];
  await db.query("CREATE TRIGGER force_grant_failure BEFORE INSERT ON point_transfer FOR EACH ROW BEGIN IF NEW.kind='GRANT' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced test failure'; END IF; END");
  try{await rejected(student(db));}finally{await db.query('DROP TRIGGER force_grant_failure');}
  assert.deepEqual([await count(db,'app_user'),await count(db,'point_account'),await count(db,'point_transfer')],before);
});
test('profile skills replace atomically and reject invalid references',async()=>{
  const a=await student(db);
  await call(db,'sp_update_profile',[a,'New name','[1,2]']);
  await rejected(call(db,'sp_update_profile',[a,'Should roll back','[999]']));
  const [[row]]=await db.execute('SELECT display_name FROM app_user WHERE user_id=?',[a]);assert.equal(row.display_name,'New name');
  const [skills]=await db.execute('SELECT * FROM user_skill WHERE user_id=?',[a]);assert.equal(skills.length,2);
  await rejected(call(db,'sp_update_profile',[await admin(db),'Admin','[]']));
});
test('post reserves exact reward; insufficient points leave no task/account/transfer',async()=>{
  const a=await student(db),q=await post(db,a);assert.equal(await balance(db,a),70);
  const [[escrow]]=await db.execute('SELECT balance FROM v_account_balance WHERE quest_id=?',[q]);assert.equal(Number(escrow.balance),30);
  const before=[await count(db,'quest'),await count(db,'point_account'),await count(db,'point_transfer')];
  await rejected(post(db,a,71));
  assert.deepEqual([await count(db,'quest'),await count(db,'point_account'),await count(db,'point_transfer')],before);
  await rejected(call(db,'sp_post_quest',[a,1,'Past deadline','Description',1,new Date(0)]));
});
test('simultaneous posts cannot overspend; waiting writer sees committed balance',async()=>{
  for(let i=0;i<5;i++) {
    const a=await student(db);
    const results=await Promise.allSettled([post(db,a,70),post(db,a,70)]);
    assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(await balance(db,a),30);
  }
});
test('self/expired/admin claims fail; simultaneous claims have one lifetime winner and conversation',async()=>{
  for(let i=0;i<5;i++) {
    const a=await student(db),b=await student(db),c=await student(db),q=await post(db,a);
    await rejected(call(db,'sp_claim_quest',[a,q]));
    const results=await Promise.allSettled([call(db,'sp_claim_quest',[b,q]),call(db,'sp_claim_quest',[c,q])]);
    assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
    const [[row]]=await db.execute('SELECT COUNT(*) n FROM conversation WHERE quest_id=?',[q]);assert.equal(Number(row.n),1);
    await rejected(call(db,'sp_claim_quest',[b,q]));
  }
  const a=await student(db),q=await post(db,a);await db.execute('UPDATE quest SET deadline=? WHERE quest_id=?',[new Date(0),q]);
  await rejected(call(db,'sp_claim_quest',[await student(db),q]));
  await call(db,'sp_cancel',[a,q]); // expiry does not prevent requester cancellation
  await rejected(call(db,'sp_claim_quest',[await admin(db),await post(db,a,1)]));
});
test('claim transaction rolls back if conversation creation fails',async()=>{
  const a=await student(db),b=await student(db),q=await post(db,a);
  await db.query("CREATE TRIGGER force_conversation_failure BEFORE INSERT ON conversation FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced test failure'");
  try{await rejected(call(db,'sp_claim_quest',[b,q]));}finally{await db.query('DROP TRIGGER force_conversation_failure');}
  const [[row]]=await db.execute('SELECT state FROM quest WHERE quest_id=?',[q]);assert.equal(row.state,'OPEN');
  const [[claims]]=await db.execute('SELECT COUNT(*) n FROM claim WHERE quest_id=?',[q]);assert.equal(Number(claims.n),0);
});
test('only helper submits, multiple submissions allowed after deadline; composite FK blocks cross-claim approval',async()=>{
  const a=await student(db),b=await student(db),c=await student(db),x=await submitted(db,a,b,10),y=await submitted(db,a,c,10);
  await rejected(call(db,'sp_submit',[c,x.q,'Unrelated work']));
  await db.execute('UPDATE quest SET deadline=? WHERE quest_id=?',[new Date(0),x.q]);
  await call(db,'sp_submit',[b,x.q,'Second version after the claim deadline']);
  await rejected(call(db,'sp_approve',[b,x.q,x.s]));
  await rejected(call(db,'sp_approve',[a,x.q,y.s]));
  const [[row]]=await db.execute('SELECT state FROM quest WHERE quest_id=?',[x.q]);assert.equal(row.state,'SUBMITTED');
});
test('worked example: A100/B100 → A70/escrow30/B100 → A70/escrow0/B130; repeat approval fails',async()=>{
  const a=await student(db),b=await student(db);assert.equal(await balance(db,a),100);assert.equal(await balance(db,b),100);
  const x=await submitted(db,a,b);assert.equal(await balance(db,a),70);assert.equal(await balance(db,b),100);
  await call(db,'sp_approve',[a,x.q,x.s]);assert.equal(await balance(db,a),70);assert.equal(await balance(db,b),130);
  const [[escrow]]=await db.execute('SELECT balance FROM v_account_balance WHERE quest_id=?',[x.q]);assert.equal(Number(escrow.balance),0);
  await rejected(call(db,'sp_approve',[a,x.q,x.s]));await rejected(call(db,'sp_cancel',[a,x.q]));
  await rejected(call(db,'sp_submit',[b,x.q,'Too late']));await invariants(db);
});
test('payout failure rolls back approval, state and balances together',async()=>{
  const a=await student(db),b=await student(db),x=await submitted(db,a,b);
  await db.query("CREATE TRIGGER force_payout_failure BEFORE INSERT ON point_transfer FOR EACH ROW BEGIN IF NEW.kind='PAYOUT' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced test failure'; END IF; END");
  try{await rejected(call(db,'sp_approve',[a,x.q,x.s]));}finally{await db.query('DROP TRIGGER force_payout_failure');}
  assert.equal(await balance(db,b),100);
  const [[row]]=await db.execute('SELECT state FROM quest WHERE quest_id=?',[x.q]);assert.equal(row.state,'SUBMITTED');
  const [[approval]]=await db.execute('SELECT COUNT(*) n FROM approval WHERE claim_id=?',[x.c]);assert.equal(Number(approval.n),0);
});
test('refund returns points once and prevents payout or further claims',async()=>{
  const a=await student(db),b=await student(db),q=await post(db,a);
  await rejected(call(db,'sp_cancel',[b,q]));await call(db,'sp_cancel',[a,q]);assert.equal(await balance(db,a),100);
  await rejected(call(db,'sp_cancel',[a,q]));await rejected(call(db,'sp_claim_quest',[b,q]));await rejected(call(db,'sp_approve',[a,q,1]));
});
test('NULL actor arguments cannot bypass SQL ownership checks',async()=>{
  const a=await student(db),b=await student(db),x=await submitted(db,a,b,10),q=await post(db,a,10);
  for(const [proc,args] of [['sp_submit',[null,x.q,'Bypass']],['sp_approve',[null,x.q,x.s]],['sp_cancel',[null,q]],['sp_rate',[null,x.q,5,'Bypass']],['sp_read_messages',[null,x.q,0]]])await rejected(call(db,proc,args));
  for(const [proc,args] of [['sp_open_dispute',[null,x.q,'Bypass']],['sp_read_submissions',[null,x.q,0]],['sp_read_disputes',[null,x.q,0]],['sp_read_wallet',[null,0]]])await rejected(call(db,proc,args));
});
test('transfer trigger rejects wrong owner/kind/amount; guards reject duplicate reserve and mixed settlement keys',async()=>{
  const a=await student(db),b=await student(db),x=await submitted(db,a,b);
  const [accounts]=await db.execute('SELECT account_id,user_id,quest_id FROM point_account WHERE user_id IN (?,?) OR quest_id=?',[a,b,x.q]);
  const aa=accounts.find(r=>String(r.user_id)===a).account_id,bb=accounts.find(r=>String(r.user_id)===b).account_id,esc=accounts.find(r=>String(r.quest_id)===x.q).account_id;
  const insert=(f,t,n,k,key)=>db.execute('INSERT INTO point_transfer(from_account_id,to_account_id,amount,kind,idempotency_key) VALUES(?,?,?,?,?)',[f,t,n,k,key]);
  await rejected(insert(esc,aa,30,'PAYOUT','wrong-recipient'));
  await rejected(insert(esc,bb,29,'PAYOUT','wrong-amount'));
  await rejected(insert(aa,esc,30,'RESERVE','repeat-reserve'));
  await rejected(insert(aa,aa,1,'RESERVE','same-account'));
  await call(db,'sp_approve',[a,x.q,x.s]);
  await rejected(insert(esc,aa,30,'REFUND','refund-different-key'));
});
test('ratings require approval, requester, score 1–5 and one rating per claim',async()=>{
  const a=await student(db),b=await student(db),x=await submitted(db,a,b);
  await rejected(call(db,'sp_rate',[a,x.q,5,'Too early']));
  await call(db,'sp_approve',[a,x.q,x.s]);
  await rejected(call(db,'sp_rate',[b,x.q,5,'Wrong actor']));
  await rejected(call(db,'sp_rate',[a,x.q,6,'Bad score']));
  await call(db,'sp_rate',[a,x.q,5,'Helpful']);await rejected(call(db,'sp_rate',[a,x.q,4,'Duplicate']));
  const [[row]]=await db.execute('SELECT rating_count,average_score FROM v_student_rating WHERE user_id=?',[b]);assert.equal(Number(row.rating_count),1);assert.equal(Number(row.average_score),5);
});
test('chat checks both readers and senders; comments preserve the authenticated author',async()=>{
  const a=await student(db),b=await student(db),c=await student(db),x=await submitted(db,a,b);
  await rejected(call(db,'sp_send_message',[c,x.q,'Let me in']));await rejected(call(db,'sp_read_messages',[c,x.q,0]));
  await rejected(call(db,'sp_send_message',[a,x.q,'  ']));
  await call(db,'sp_send_message',[a,x.q,'Meet at the library?']);await call(db,'sp_send_message',[b,x.q,'Yes.']);
  const messages=await call(db,'sp_read_messages',[b,x.q,0]);assert.equal(messages.length,2);assert.equal(String(messages[0].sender_id),a);
  await call(db,'sp_comment',[c,x.q,'Good study spot.']);
  const [[comment]]=await db.execute('SELECT author_id FROM quest_comment WHERE quest_id=?',[x.q]);assert.equal(String(comment.author_id),c);
});
test('dispute permissions, independent admin, unresolved freeze, RESUME and terminal rules',async()=>{
  const a=await student(db),b=await student(db),c=await student(db),ad=await admin(db),other=await admin(db),x=await submitted(db,a,b);
  await rejected(call(db,'sp_open_dispute',[c,x.q,'Unrelated']));await call(db,'sp_open_dispute',[b,x.q,'Need clarification']);
  await rejected(call(db,'sp_open_dispute',[a,x.q,'Duplicate']));await rejected(call(db,'sp_approve',[a,x.q,x.s]));await rejected(call(db,'sp_cancel',[a,x.q]));
  await rejected(call(db,'sp_assign_dispute',[a,x.q,ad]));await rejected(call(db,'sp_assign_dispute',[ad,x.q,b]));
  // Even a privileged role change cannot make a participant an independent admin.
  await db.execute("UPDATE app_user SET role='ADMIN' WHERE user_id=?",[b]);
  await rejected(call(db,'sp_assign_dispute',[ad,x.q,b]));await rejected(call(db,'sp_assign_dispute',[b,x.q,ad]));
  await db.execute("UPDATE app_user SET role='STUDENT' WHERE user_id=?",[b]);
  await rejected(call(db,'sp_resolve_dispute',[ad,x.q,'REFUND','Not assigned']));
  await call(db,'sp_assign_dispute',[ad,x.q,ad]);
  await rejected(call(db,'sp_assign_dispute',[ad,x.q,other]));await rejected(call(db,'sp_resolve_dispute',[other,x.q,'REFUND','Wrong admin']));
  await rejected(call(db,'sp_resolve_dispute',[ad,x.q,'PAYOUT','Invalid']));await rejected(call(db,'sp_resolve_dispute',[ad,x.q,'RESUME',' ']));
  await call(db,'sp_resolve_dispute',[ad,x.q,'RESUME','Both agreed to continue.']);
  await rejected(call(db,'sp_resolve_dispute',[ad,x.q,'REFUND','Already resolved']));
  await call(db,'sp_approve',[a,x.q,x.s]);await rejected(call(db,'sp_open_dispute',[a,x.q,'Terminal']));
});
test('dispute REFUND cancels atomically; forced refund failure rolls back resolution',async()=>{
  const a=await student(db),b=await student(db),ad=await admin(db),x=await submitted(db,a,b);
  await call(db,'sp_open_dispute',[a,x.q,'Cannot continue']);await call(db,'sp_assign_dispute',[ad,x.q,ad]);
  await db.query("CREATE TRIGGER force_refund_failure BEFORE INSERT ON point_transfer FOR EACH ROW BEGIN IF NEW.kind='REFUND' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced test failure'; END IF; END");
  try{await rejected(call(db,'sp_resolve_dispute',[ad,x.q,'REFUND','Both agreed.']));}finally{await db.query('DROP TRIGGER force_refund_failure');}
  const [[row]]=await db.execute('SELECT status FROM dispute WHERE quest_id=?',[x.q]);assert.equal(row.status,'IN_REVIEW');assert.equal(await balance(db,a),70);
  await call(db,'sp_resolve_dispute',[ad,x.q,'REFUND','Both agreed.']);assert.equal(await balance(db,a),100);
  await rejected(call(db,'sp_approve',[a,x.q,x.s]));await invariants(db);
});
test('racing approval, ordinary refund and dispute serialize on the task',async()=>{
  for(let i=0;i<8;i++){
    const a=await student(db),b=await student(db),x=await submitted(db,a,b);
    const operations=[()=>call(db,'sp_approve',[a,x.q,x.s]),()=>call(db,'sp_open_dispute',[b,x.q,'Clarify scope']),()=>call(db,'sp_cancel',[a,x.q])];
    if(i%2)operations.reverse();
    const results=await Promise.allSettled(operations.map(f=>f()));assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
    const [[q]]=await db.execute('SELECT state FROM quest WHERE quest_id=?',[x.q]);
    const [[d]]=await db.execute('SELECT COUNT(*) n FROM dispute WHERE quest_id=?',[x.q]);
    assert.equal(Number(d.n),q.state==='COMPLETED'?0:1);await invariants(db);
  }
});
test('racing claim/cancel and repeated admin resolutions never double settle',async()=>{
  for(let i=0;i<5;i++){
    const a=await student(db),b=await student(db),q=await post(db,a);
    const r=await Promise.allSettled([call(db,'sp_claim_quest',[b,q]),call(db,'sp_cancel',[a,q])]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);
    await invariants(db);
  }
  const a=await student(db),b=await student(db),ad=await admin(db),x=await submitted(db,a,b);
  await call(db,'sp_open_dispute',[a,x.q,'A refund is needed']);await call(db,'sp_assign_dispute',[ad,x.q,ad]);
  const r=await Promise.allSettled([call(db,'sp_resolve_dispute',[ad,x.q,'REFUND','Agreed']),call(db,'sp_resolve_dispute',[ad,x.q,'REFUND','Agreed'])]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);await invariants(db);
});
test('least privilege: runtime CALL works; direct writes/internal helpers/report sensitive reads fail',async t=>{
  if(!dcl)return t.skip('No project DCL administrator; configure 05_permissions before rerunning');
  const a=await student(runtime);assert.equal(await balance(runtime,a),100);
  await assert.rejects(runtime.query("UPDATE app_user SET role='ADMIN'"),e=>e.errno===1142 || e.errno===1143);
  await assert.rejects(runtime.query('SELECT * FROM chat_message'),e=>e.errno===1142);
  await assert.rejects(runtime.query('CALL _move_points(1,2,100,\'GRANT\',\'bad\')'),e=>e.errno===1370);
  const report=createPool({database:'campus_sidequest_test',user:process.env.REPORT_USER,password:process.env.REPORT_PASSWORD});
  try {
    await report.query('SELECT * FROM v_leaderboard');
    await assert.rejects(report.query('SELECT * FROM category'),e=>e.errno===1142);
    await db.query("GRANT SELECT ON campus_sidequest_test.category TO 'csq_report_role'");
    await report.query('SELECT * FROM category');
    await db.query("REVOKE SELECT ON campus_sidequest_test.category FROM 'csq_report_role'");
    await assert.rejects(report.query('SELECT * FROM category'),e=>e.errno===1142);
    for(const table of ['app_user','chat_message','point_transfer'])await assert.rejects(report.query(`SELECT * FROM ${table}`),e=>e.errno===1142 || e.errno===1143);
    await assert.rejects(report.query('CALL sp_read_messages(1,1,0)'),e=>e.errno===1370);
  }finally{await report.end();}
});
test('clean installation, safe schema/seed rerun, fictional seed covers every table and lifecycle',async()=>{
  await importSQL(db,'database/04_seed.sql');
  const before={};for(const table of ['app_user','quest','point_account','point_transfer'])before[table]=await count(db,table);
  await db.query("UPDATE app_user SET display_name='Prince (edited)' WHERE campus_email='prince@demo.campus.test'");
  await setup('campus_sidequest_test');await importSQL(db,'database/04_seed.sql');
  for(const table of Object.keys(before))assert.equal(await count(db,table),before[table]);
  const [[u]]=await db.query("SELECT display_name FROM app_user WHERE campus_email='prince@demo.campus.test'");assert.equal(u.display_name,'Prince (edited)');
  const [[open]]=await db.query("SELECT COUNT(*) n FROM quest q JOIN app_user u ON u.user_id=q.poster_id WHERE q.state='OPEN' AND u.campus_email IN ('prince@demo.campus.test','jayant@demo.campus.test','dhruv@demo.campus.test','siddhanth@demo.campus.test')");
  assert.equal(Number(open.n),6);
  for(const table of ['app_user','skill','user_skill','category','quest','claim','submission','approval','rating','point_account','point_transfer','conversation','chat_message','quest_comment','dispute'])assert.ok(await count(db,table)>0);
  const [states]=await db.query('SELECT DISTINCT state FROM quest');assert.equal(states.length,5);
  const [statuses]=await db.query('SELECT DISTINCT status FROM dispute');assert.equal(statuses.length,3);
  await invariants(db);
});
test('representative EXPLAIN and views do not multiply ratings or earned points',async()=>{
  const a=await student(db),b=await student(db),x=await submitted(db,a,b,10);
  await call(db,'sp_submit',[b,x.q,'Another submission']);await call(db,'sp_comment',[a,x.q,'A comment']);
  await call(db,'sp_approve',[a,x.q,x.s]);await call(db,'sp_rate',[a,x.q,4,'Good work']);
  const [[row]]=await db.execute('SELECT * FROM v_leaderboard WHERE user_id=?',[b]);assert.equal(Number(row.earned_points),10);assert.equal(Number(row.completed_count),1);assert.equal(Number(row.rating_count),1);
  const [plan]=await db.query("EXPLAIN SELECT * FROM quest WHERE state='OPEN' AND category_id=1 ORDER BY created_at DESC LIMIT 6");assert.ok(plan.some(x=>String(x.possible_keys).includes('ix_quest_board')));
  const [chat]=await db.query('EXPLAIN SELECT * FROM chat_message WHERE conversation_id=1 ORDER BY sent_at,message_id LIMIT 100');assert.ok(chat.some(x=>String(x.possible_keys).includes('ix_message_time')));
  await invariants(db);
});
test('teaching query file and complete SQL-only demo execute against MySQL',async()=>{
  const c=await db.getConnection();
  try {
    await importSQL(c,'database/07_sql_workflow_demo.sql');
    await importSQL(c,'database/06_demo_queries.sql');
  }finally{c.release();}
  await invariants(db);
});
