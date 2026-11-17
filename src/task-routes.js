import { call } from './db.js';
import { HttpError, id, integer, text } from './validation.js';

// Routes only validate input and identify the actor. SQL owns workflow changes.
export function taskRoutes(app, pool, authenticated) {
  const admin = async (req,res,next) => {
    const [[user]]=await pool.execute('SELECT role FROM app_user WHERE user_id=?',[req.session.userId]);
    if(user?.role!=='ADMIN') throw new HttpError(403,'An admin account is required.');
    next();
  };
  const offset = req => (Number(id(req.query.page || 1,'Page',10000))-1)*20;
  const empty = body => {
    if(Object.keys(body).length) throw new HttpError(400,'This action needs no extra fields.');
  };
  const write = (route, procedure, values) => app.post('/api/quests/:id/'+route,authenticated,async(req,res)=>{
    const result=await call(pool,procedure,[req.session.userId,id(req.params.id),...values(req.body)]);
    res.status(201).json(result[0] || {ok:true});
  });
  write('submit','sp_submit',body=>[text(body.evidence,'Work summary',5000)]);
  write('approve','sp_approve',body=>[id(body.submissionId,'Submission')]);
  write('cancel','sp_cancel',body=>{empty(body);return [];});
  write('rating','sp_rate',body=>[integer(body.score,'Rating',1,5),text(body.comment ?? '','Review',1000,0) || null]);
  write('comments','sp_comment',body=>[text(body.body,'Comment',1000)]);
  write('messages','sp_send_message',body=>[text(body.body,'Message',2000)]);
  write('dispute','sp_open_dispute',body=>[text(body.reason,'Reason',2000)]);

  app.get('/api/quests/:id/comments',async(req,res)=>{
    const [rows]=await pool.query('SELECT * FROM v_public_comment WHERE quest_id=? ORDER BY comment_id DESC LIMIT 20 OFFSET ?',[id(req.params.id),offset(req)]);
    res.json(rows);
  });
  app.get('/api/quests/:id/rating',async(req,res)=>{
    const [[row]]=await pool.execute('SELECT * FROM v_public_rating WHERE quest_id=?',[id(req.params.id)]);
    res.json(row || null);
  });
  app.get('/api/quests/:id/submissions',authenticated,async(req,res)=>{
    res.json(await call(pool,'sp_read_submissions',[req.session.userId,id(req.params.id),offset(req)]));
  });
  app.get('/api/quests/:id/messages',authenticated,async(req,res)=>{
    const after=req.query.after===undefined ? '0' : id(req.query.after,'Message');
    res.json(await call(pool,'sp_read_messages',[req.session.userId,id(req.params.id),after]));
  });
  app.get('/api/quests/:id/dispute',authenticated,async(req,res)=>{
    const rows=await call(pool,'sp_read_disputes',[req.session.userId,id(req.params.id),0]);
    res.json(rows[0] || null);
  });
  app.get('/api/wallet',authenticated,async(req,res)=>{
    const [history,[[account]]]=await Promise.all([
      call(pool,'sp_read_wallet',[req.session.userId,offset(req)]),
      pool.execute('SELECT balance FROM v_account_balance WHERE user_id=?',[req.session.userId])
    ]);
    res.json({balance:Number(account?.balance || 0),history});
  });
  app.get('/api/leaderboard',async(req,res)=>{
    const [rows]=await pool.query('SELECT * FROM v_leaderboard ORDER BY earned_points DESC,completed_count DESC,user_id LIMIT 20 OFFSET ?',[offset(req)]);
    res.json(rows);
  });
  app.get('/api/admin/disputes',authenticated,admin,async(req,res)=>{
    res.json(await call(pool,'sp_read_disputes',[req.session.userId,null,offset(req)]));
  });
  app.post('/api/admin/disputes/:id/assign',authenticated,admin,async(req,res)=>{
    empty(req.body);
    await call(pool,'sp_assign_dispute',[req.session.userId,id(req.params.id),req.session.userId]);
    res.json({ok:true});
  });
  app.post('/api/admin/disputes/:id/resolve',authenticated,admin,async(req,res)=>{
    if(!['RESUME','REFUND'].includes(req.body.decision)) throw new HttpError(400,'Choose resume or refund.');
    await call(pool,'sp_resolve_dispute',[req.session.userId,id(req.params.id),req.body.decision,text(req.body.note,'Resolution note',2000)]);
    res.json({ok:true});
  });
}
