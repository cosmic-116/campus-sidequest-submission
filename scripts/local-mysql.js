// Optional Windows convenience. Owns only .local/mysql-data on 127.0.0.1:3407.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import { setup } from './setup.js';

const root = path.resolve('.local');
const data = path.join(root, 'mysql-data');
const binary = process.env.MYSQLD_PATH || 'C:/Program Files/MySQL/MySQL Server 8.0/bin/mysqld.exe';
const secretFile = path.join(root, 'mysql-admin.json');
const command = process.argv[2];
const random = () => crypto.randomBytes(24).toString('hex');
async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }
async function start() {
  const secrets = JSON.parse(await fs.readFile(secretFile, 'utf8'));
  try {
    const c = await mysql.createConnection({host:'127.0.0.1',port:3407,user:'root',password:secrets.root,connectTimeout:1000});
    const [[row]] = await c.query('SELECT @@datadir AS data'); await c.end();
    if (path.resolve(row.data).toLowerCase() !== data.toLowerCase()) throw new Error('Port 3407 belongs to another instance');
    console.log('Project MySQL is already running on 127.0.0.1:3407.'); return;
  } catch (e) { if (e.code !== 'ECONNREFUSED') throw e; }
  // windowsHide keeps the helper out of the way; no service or firewall changes.
  const child = spawn(binary,['--no-defaults',`--datadir=${data}`,'--port=3407','--bind-address=127.0.0.1','--mysqlx=OFF','--skip-log-bin','--default-time-zone=+00:00', '--console'],{detached:true,windowsHide:true,stdio:'ignore'});
  child.unref();
  await fs.writeFile(path.join(root,'mysqld.pid'),String(child.pid));
  for (let i=0;i<60;i++) {
    try { const c=await mysql.createConnection({host:'127.0.0.1',port:3407,user:'root',password:secrets.root,connectTimeout:500}); await c.end(); console.log('Project MySQL ready on 127.0.0.1:3407.'); return; }
    catch { await new Promise(r=>setTimeout(r,500)); }
  }
  throw new Error('MySQL did not start. Check .local/mysql-data/*.err');
}
try {
if (command==='init') {
  if (await exists('.env')) throw new Error('Existing .env found. Nothing changed; use local:start instead.');
  const resume = await exists(secretFile) && (await fs.readFile(secretFile,'utf8')).includes('"root":""');
  if (await exists(data) && !resume) throw new Error('Existing data found without an unfinished initialization marker. Nothing changed.');
  await fs.mkdir(root,{recursive:true});
  if (!resume) {
    const result=spawnSync(binary,['--no-defaults','--initialize-insecure',`--datadir=${data}`],{windowsHide:true,encoding:'utf8'});
    if(result.status!==0) throw new Error('MySQL initialization failed; inspect the local error log.');
  }
  const secrets={root:'',migration:random(),runtime:random(),report:random()};
  await fs.writeFile(secretFile,JSON.stringify(secrets),{mode:0o600});
  await start();
  const c=await mysql.createConnection({host:'127.0.0.1',port:3407,user:'root',password:''});
  secrets.root=random();
  await c.query('ALTER USER CURRENT_USER() IDENTIFIED BY ?',[secrets.root]);
  await fs.writeFile(secretFile,JSON.stringify(secrets),{mode:0o600});
  const vars={DB_HOST:'127.0.0.1',DB_PORT:'3407',DB_NAME:'campus_sidequest',DB_USER:'csq_runtime',DB_PASSWORD:secrets.runtime,MIGRATION_USER:'csq_migration',MIGRATION_PASSWORD:secrets.migration,REPORT_USER:'csq_report',REPORT_PASSWORD:secrets.report,SESSION_SECRET:random(),PORT:'3000'};
  await fs.writeFile('.env',Object.entries(vars).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600});
  Object.assign(process.env,vars);
  for (const db of ['campus_sidequest','campus_sidequest_test']) {
    await c.query(`CREATE DATABASE \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  }
  await c.query("CREATE USER 'csq_migration'@'localhost' IDENTIFIED BY ?",[secrets.migration]);
  for (const db of ['campus_sidequest','campus_sidequest_test']) await c.query(`GRANT ALL PRIVILEGES ON \`${db}\`.* TO 'csq_migration'@'localhost' WITH GRANT OPTION`);
  for (const role of ['csq_runtime_role','csq_report_role']) await c.query(`CREATE ROLE IF NOT EXISTS '${role}'`);
  for (const db of ['campus_sidequest','campus_sidequest_test']) await setup(db);
  // Roles are shared between these two databases; grants are deliberately narrow.
  for (const [user,key,role] of [['csq_runtime','runtime','csq_runtime_role'],['csq_report','report','csq_report_role']]) {
    await c.query(`CREATE USER '${user}'@'localhost' IDENTIFIED BY ?`,[secrets[key]]);
    await c.query(`GRANT '${role}' TO '${user}'@'localhost'`);
    await c.query(`SET DEFAULT ROLE '${role}' TO '${user}'@'localhost'`);
  }
  const {applyPermissions}=await import('./permissions.js');
  for (const db of ['campus_sidequest','campus_sidequest_test']) await applyPermissions(c,db);
  await c.end();
  console.log('Isolated database initialized; random credentials saved in ignored .env and .local. Run npm run db:seed.');
} else if (command==='configure') {
  // Resume provisioning our own new instance after an interrupted first setup.
  const secrets=JSON.parse(await fs.readFile(secretFile,'utf8'));
  process.loadEnvFile('.env');
  const c=await mysql.createConnection({host:'127.0.0.1',port:3407,user:'root',password:secrets.root});
  const [[row]]=await c.query('SELECT @@datadir AS data');
  if(path.resolve(row.data).toLowerCase()!==data.toLowerCase()) throw new Error('This is a different instance');
  await c.query("CREATE USER IF NOT EXISTS 'csq_migration'@'localhost' IDENTIFIED BY ?",[secrets.migration]);
  for(const role of ['csq_runtime_role','csq_report_role']) await c.query(`CREATE ROLE IF NOT EXISTS '${role}'`);
  for(const db of ['campus_sidequest','campus_sidequest_test']) {
    await c.query(`CREATE DATABASE IF NOT EXISTS \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await c.query(`GRANT ALL PRIVILEGES ON \`${db}\`.* TO 'csq_migration'@'localhost' WITH GRANT OPTION`);
    await setup(db);
  }
  for(const role of ['csq_runtime_role','csq_report_role']) await c.query(`CREATE ROLE IF NOT EXISTS '${role}'`);
  for(const [user,key,role] of [['csq_runtime','runtime','csq_runtime_role'],['csq_report','report','csq_report_role']]) {
    await c.query(`CREATE USER IF NOT EXISTS '${user}'@'localhost' IDENTIFIED BY ?`,[secrets[key]]);
    await c.query(`GRANT '${role}' TO '${user}'@'localhost'`);
    await c.query(`SET DEFAULT ROLE '${role}' TO '${user}'@'localhost'`);
  }
  const {applyPermissions}=await import('./permissions.js');
  for(const db of ['campus_sidequest','campus_sidequest_test']) await applyPermissions(c,db);
  await c.end(); console.log('Project provisioning complete. Existing rows preserved.');
} else if (command==='start') await start();
else if (command==='stop') {
  const secrets=JSON.parse(await fs.readFile(secretFile,'utf8'));
  const c=await mysql.createConnection({host:'127.0.0.1',port:3407,user:'root',password:secrets.root});
  const [[row]]=await c.query('SELECT @@datadir AS data');
  if(path.resolve(row.data).toLowerCase()!==data.toLowerCase()) throw new Error('Refusing to stop a different instance');
  try {await c.query('SHUTDOWN');} finally {await c.end();}
  console.log('Project MySQL stopped. Data preserved.');
} else throw new Error('Use init, configure, start or stop. No reset command is provided for development data.');
} catch (error) {
  // mysql2 errors can contain expanded CREATE USER SQL: never log that object.
  console.error(error.sql ? `Local MySQL setup failed (${error.code || 'database error'}). Check the setup guide and local server log.` : error.message);
  process.exitCode=1;
}
