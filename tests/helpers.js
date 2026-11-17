import mysql from 'mysql2/promise';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { setup } from '../scripts/setup.js';
import { applyPermissions } from '../scripts/permissions.js';
import { createPool, connectionOptions, call } from '../src/db.js';

export const hash='$2b$12$M0sNED5jQtYmuqBSmGN0Cu8YSmAr45pBftff2CZYgZWrdW96CtqO.';
export const future=()=>new Date(Date.now()+86400_000);
export async function prepare() {
  if(process.env.CSQ_TEST_RESET!=='campus_sidequest_test') throw new Error('Test reset not explicitly authorized');
  const migration=createPool({database:undefined,user:process.env.MIGRATION_USER,password:process.env.MIGRATION_PASSWORD});
  await migration.query('DROP DATABASE IF EXISTS campus_sidequest_test');
  await migration.end();
  await setup('campus_sidequest_test');
  let dcl=false;
  try {
    const secret=JSON.parse(await fs.readFile('.local/mysql-admin.json','utf8'));
    const admin=await mysql.createConnection(connectionOptions({database:undefined,user:'root',password:secret.root}));
    try {
      const [[row]]=await admin.query('SELECT @@datadir AS data');
      if(path.resolve(row.data).toLowerCase()!==path.resolve('.local/mysql-data').toLowerCase()) throw new Error('Not the project instance');
      await applyPermissions(admin,'campus_sidequest_test');dcl=true;
    }finally{await admin.end();}
  }catch(e){if(e.code!=='ENOENT') throw e;}
  return { db:createPool({database:'campus_sidequest_test',user:process.env.MIGRATION_USER,password:process.env.MIGRATION_PASSWORD}),
    runtime:createPool({database:'campus_sidequest_test'}),dcl };
}
let sequence=0;
export async function student(db,name='Student') {
  const [row]=await call(db,'sp_register',[`student${++sequence}@tests.campus.test`,name,hash]);return String(row.user_id);
}
export async function admin(db) {
  const [result]=await db.execute("INSERT INTO app_user(campus_email,display_name,password_hash,role) VALUES(?,?,?,'ADMIN')",[`admin${++sequence}@tests.campus.test`,'Demo admin',hash]);return String(result.insertId);
}
export async function post(db,actor,reward=30,title='Practice SQL joins') {
  const [row]=await call(db,'sp_post_quest',[actor,1,title,'A small test request with real ledger entries.',reward,future()]);return String(row.quest_id);
}
export async function submitted(db,a,b,reward=30) {
  const q=await post(db,a,reward);
  const [claim]=await call(db,'sp_claim_quest',[b,q]);
  const [submission]=await call(db,'sp_submit',[b,q,'Worked through the example together.']);
  return {q,c:String(claim.claim_id),s:String(submission.submission_id)};
}
export async function balance(db,user) {
  const [[row]]=await db.execute('SELECT balance FROM v_account_balance WHERE user_id=?',[user]);return Number(row.balance);
}
export async function count(db,table) {
  assert.match(table,/^[a-z_]+$/);const [[row]]=await db.query(`SELECT COUNT(*) n FROM ${table}`);return Number(row.n);
}
export const rejected=promise=>assert.rejects(promise,e=>[1644,1062,3819,1452,1048,1264,1366,1406].includes(e.errno));
export async function invariants(db) {
  const [[n]]=await db.query("SELECT COUNT(*) n FROM v_account_balance WHERE kind<>'SYSTEM' AND balance<0");assert.equal(Number(n.n),0);
  const [[sum]]=await db.query('SELECT SUM(balance) n FROM v_account_balance');assert.equal(Number(sum.n),0);
  const [[settle]]=await db.query("SELECT COUNT(*) n FROM (SELECT from_account_id FROM point_transfer WHERE kind IN ('PAYOUT','REFUND') GROUP BY from_account_id HAVING COUNT(*)>1) x");assert.equal(Number(settle.n),0);
}
