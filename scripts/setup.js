import mysql from 'mysql2/promise';
import { pathToFileURL } from 'node:url';
import { connectionOptions } from '../src/db.js';
import { importSQL } from './sql.js';
import { applyPermissions } from './permissions.js';

export function safeDatabase(name) {
  if (!/^campus_sidequest(?:_test)?$/.test(name)) throw new Error('Use campus_sidequest or campus_sidequest_test');
  return name;
}

export async function setup(database = process.env.DB_NAME) {
  safeDatabase(database);
  const c = await mysql.createConnection(connectionOptions({ database: undefined, user: process.env.MIGRATION_USER, password: process.env.MIGRATION_PASSWORD }));
  try {
    await c.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await c.query(`USE \`${database}\``);
    for (const file of ['01_schema.sql','02_views.sql','03_routines.sql']) await importSQL(c, `database/${file}`);
    // DROP/CREATE routines removes their routine grants. Reapply them on every setup.
    await applyPermissions(c,database);
  } finally { await c.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await setup(process.env.DB_NAME || 'campus_sidequest');
  console.log('Schema, views and routines installed. Existing rows preserved.');
}
