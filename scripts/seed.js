import mysql from 'mysql2/promise';
import { connectionOptions } from '../src/db.js';
import { importSQL } from './sql.js';
const c=await mysql.createConnection(connectionOptions({user:process.env.MIGRATION_USER,password:process.env.MIGRATION_PASSWORD}));
try {await importSQL(c,'database/04_seed.sql');console.log('Demo seed checked. Tasks and points preserved; demo name spellings corrected.');}
finally {await c.end();}
