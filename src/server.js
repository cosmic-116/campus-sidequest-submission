import { createPool } from './db.js';
import { createApp } from './app.js';
const pool=createPool();
await pool.query('SELECT 1');
const app=createApp(pool,{secure:process.env.HTTPS==='true'});
const server=app.listen(Number(process.env.PORT || 3000),'127.0.0.1',()=>console.log(`Campus SideQuest: http://localhost:${process.env.PORT || 3000}`));
async function shutdown() {server.close(); app.locals.store.close(); await pool.end();}
process.on('SIGINT',async()=>{await shutdown();process.exit(0);});
process.on('SIGTERM',async()=>{await shutdown();process.exit(0);});
