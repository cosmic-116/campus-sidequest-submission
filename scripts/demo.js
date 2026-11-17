import { createPool } from '../src/db.js';
import { importSQL } from './sql.js';
if(process.env.DB_NAME!=='campus_sidequest')throw new Error('This demo only targets the named local development schema.');
const pool=createPool({user:process.env.MIGRATION_USER,password:process.env.MIGRATION_PASSWORD});
const c=await pool.getConnection();
try{
  await importSQL(c,'database/07_sql_workflow_demo.sql',result=>{
    // Show SELECT result sets only, not SQL text or any connection configuration.
    if(Array.isArray(result) && result.length && !Array.isArray(result[0]))console.table(result);
    if(Array.isArray(result) && Array.isArray(result[0]) && result[0].length)console.table(result[0]);
  });
}finally{c.release();await pool.end();}
