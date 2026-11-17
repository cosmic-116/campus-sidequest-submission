import express from 'express';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import path from 'node:path';
import { BoundedStore } from './session-store.js';
import { taskRoutes } from './task-routes.js';
import { call } from './db.js';
import { HttpError, text, id, email, password, integer, deadline } from './validation.js';

const publicFields = 'user_id,campus_email,display_name,role,joined_at';
const token = () => crypto.randomBytes(24).toString('hex');
const renew = req => new Promise((resolve,reject) => req.session.regenerate(e => e ? reject(e) : resolve()));

export function createApp(pool, { secret = process.env.SESSION_SECRET, secure = false, store = new BoundedStore() } = {}) {
  if (!secret || secret.length < 32) throw new Error('Set SESSION_SECRET to at least 32 random characters');
  const app = express();
  app.disable('x-powered-by');
  app.locals.store = store;
  app.use((req,res,next) => {
    res.set({ 'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin',
      'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" });
    next();
  });
  app.use(express.json({ limit: '24kb' }));
  app.use('/api', session({ name:'csq.sid', secret, store, resave:false, saveUninitialized:false,
    cookie:{httpOnly:true,sameSite:'lax',secure,maxAge:2*60*60*1000} }));
  app.use('/api', (req,res,next) => {
    res.set('Cache-Control','no-store');
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return next(new HttpError(400,'Send a JSON object with this request.'));
      const given = req.get('X-CSRF-Token');
      const expected = req.session.csrf;
      if (!expected || !given || Buffer.byteLength(given) !== Buffer.byteLength(expected) || !crypto.timingSafeEqual(Buffer.from(given),Buffer.from(expected))) return next(new HttpError(403,'Your form has expired. Refresh and try again.'));
    }
    next();
  });
  const authenticated = (req,res,next) => req.session.userId ? next() : next(new HttpError(401,'Please log in first.'));
  const user = async uid => {
    const [[row]] = await pool.execute(`SELECT ${publicFields} FROM app_user WHERE user_id=?`,[uid]);
    return row;
  };
  // Simple bounded attempt counter for a local demo, reset on server restart.
  const attempts = new Map();
  const authLimit = (req,res,next) => {
    const key=req.ip, now=Date.now();
    for (const [k,v] of attempts) if (now-v.start>600_000) attempts.delete(k);
    if(attempts.size>=1000 && !attempts.has(key)) return next(new HttpError(429,'Try again later.'));
    const row=attempts.get(key)||{count:0,start:now}; row.count++; attempts.set(key,row);
    if(row.count>60) return next(new HttpError(429,'Too many sign-in attempts. Try again in ten minutes.'));
    next();
  };
  app.get('/api/session',async (req,res) => {
    req.session.csrf ||= token();
    res.json({user:req.session.userId ? await user(req.session.userId) : null,csrf:req.session.csrf});
  });
  app.post('/api/auth/register',authLimit,async (req,res) => {
    if ('role' in req.body) throw new HttpError(400,'Public registration creates a student account.');
    const mail=email(req.body.email), name=text(req.body.displayName,'Display name',80), pass=password(req.body.password);
    const hash=await bcrypt.hash(pass,12);
    const [row]=await call(pool,'sp_register',[mail,name,hash]);
    await renew(req); req.session.userId=String(row.user_id); req.session.csrf=token();
    res.status(201).json({user:await user(row.user_id),csrf:req.session.csrf});
  });
  app.post('/api/auth/login',authLimit,async (req,res) => {
    const mail=email(req.body.email), pass=password(req.body.password);
    const [[row]]=await pool.execute('SELECT user_id,password_hash FROM app_user WHERE campus_email=?',[mail]);
    // Keep the invalid-user branch similar in cost to the invalid-password branch.
    const valid=await bcrypt.compare(pass,row?.password_hash || '$2b$12$t7Aw0DGnBAM0GvSjzYvgge7NKMtCqDLCaXXwOhP.2eJg.cZsdW1iS');
    if(!row || !valid) throw new HttpError(401,'Email or password is incorrect.');
    await renew(req); req.session.userId=String(row.user_id); req.session.csrf=token();
    res.json({user:await user(row.user_id),csrf:req.session.csrf});
  });
  app.post('/api/auth/logout',authenticated,async (req,res,next) => {
    req.session.destroy(err => { if(err) return next(err); res.clearCookie('csq.sid',{httpOnly:true,sameSite:'lax',secure}); res.status(204).end(); });
  });
  app.get('/api/catalog',async (req,res) => {
    const [[categories],[skills]]=await Promise.all([pool.query('SELECT * FROM category ORDER BY name'),pool.query('SELECT * FROM skill ORDER BY name')]);
    res.json({categories,skills});
  });
  app.get('/api/profile',authenticated,async (req,res) => {
    const [[skills],[[account]]]=await Promise.all([
      pool.execute('SELECT s.* FROM skill s JOIN user_skill us ON us.skill_id=s.skill_id WHERE us.user_id=? ORDER BY s.name',[req.session.userId]),
      pool.execute('SELECT balance FROM v_account_balance WHERE user_id=?',[req.session.userId])]);
    res.json({user:await user(req.session.userId),skills,availablePoints:Number(account?.balance || 0)});
  });
  app.put('/api/profile',authenticated,async (req,res) => {
    if(['userId','user_id','role','email'].some(k=>k in req.body)) throw new HttpError(403,'You can only edit your own name and skills.');
    const name=text(req.body.displayName,'Display name',80);
    if(!Array.isArray(req.body.skillIds) || req.body.skillIds.length>30) throw new HttpError(400,'Choose up to 30 skills.');
    const ids=req.body.skillIds.map(x=>integer(x,'Skill ID',1,2147483647));
    if(new Set(ids).size!==ids.length) throw new HttpError(400,'Choose each skill once.');
    await call(pool,'sp_update_profile',[req.session.userId,name,JSON.stringify(ids)]);
    res.json({user:await user(req.session.userId)});
  });
  app.get('/api/quests',async (req,res) => {
    const clauses=[],values=[];
    if(req.query.state) {
      if(!['OPEN','CLAIMED','SUBMITTED','COMPLETED','CANCELLED'].includes(req.query.state)) throw new HttpError(400,'Unknown task state.');
      clauses.push('state=?'); values.push(req.query.state);
    }
    if(req.query.category) {clauses.push('category_id=?');values.push(id(req.query.category,'Category',2147483647));}
    if(req.query.search) {
      const search=text(req.query.search,'Search',100);
      clauses.push("title LIKE ? ESCAPE '='"); values.push(`%${search.replace(/[=%_]/g,'=$&')}%`);
    }
    if(req.query.mine) {
      if(!req.session.userId) throw new HttpError(401,'Please log in first.');
      if(!['posted','accepted'].includes(req.query.mine)) throw new HttpError(400,'Unknown task list.');
      clauses.push(req.query.mine==='posted'?'poster_id=?':'helper_id=?'); values.push(req.session.userId);
    }
    const page=req.query.page===undefined ? 1 : Number(id(req.query.page,'Page'));
    if(page>10000) throw new HttpError(400,'Page is too large.');
    const where=clauses.length?'WHERE '+clauses.join(' AND '):'';
    const [[rows],[[count]]]=await Promise.all([
      pool.query(`SELECT * FROM v_quest_summary ${where} ORDER BY created_at DESC,quest_id DESC LIMIT ? OFFSET ?`,[...values,6,(page-1)*6]),
      pool.execute(`SELECT COUNT(*) total FROM v_quest_summary ${where}`,values)]);
    res.json({quests:rows,page,pageSize:6,total:Number(count.total)});
  });
  app.get('/api/quests/:id',async (req,res) => {
    const [[row]]=await pool.execute('SELECT * FROM v_quest_summary WHERE quest_id=?',[id(req.params.id)]);
    if(!row) throw new HttpError(404,'Task not found.');
    res.json(row);
  });
  app.post('/api/quests',authenticated,async (req,res) => {
    const body=req.body;
    if('posterId' in body || 'poster_id' in body) throw new HttpError(403,'The requester comes from your login.');
    const args=[req.session.userId,id(body.categoryId,'Category',2147483647),text(body.title,'Title',140),text(body.description,'Description',5000),integer(body.rewardPoints,'Reward',1,1000000),deadline(body.deadline)];
    const [row]=await call(pool,'sp_post_quest',args);
    res.status(201).json(row);
  });
  app.post('/api/quests/:id/claim',authenticated,async (req,res) => {
    if(Object.keys(req.body || {}).length) throw new HttpError(400,'The helper comes from your login.');
    const [row]=await call(pool,'sp_claim_quest',[req.session.userId,id(req.params.id)]);
    res.status(201).json(row);
  });
  taskRoutes(app,pool,authenticated);
  app.use('/api', (req,res,next) => next(new HttpError(404,'Endpoint not found.')));
  app.use(express.static(path.resolve('public')));
  app.use((err,req,res,next) => {
    if(res.headersSent) return next(err);
    if(err.status) return res.status(err.status).json({error:err.message});
    if(err.errno===1062) return res.status(409).json({error:'That email or record already exists.'});
    if(err.errno===1644) return res.status(409).json({error:err.sqlMessage});
    if([1452,3819,1048,1406].includes(err.errno)) return res.status(400).json({error:'Check the values you entered and try again.'});
    if([1213,1205].includes(err.errno)) return res.status(409).json({error:'Another request is using this task. Try again.'});
    console.error('Request failed:',err.code || err.name); // no SQL, hashes or credentials
    res.status(500).json({error:'Something went wrong. Please try again.'});
  });
  return app;
}
