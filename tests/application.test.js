import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import {createApp} from '../src/app.js';
import {prepare,student,admin,post,hash,future,balance,invariants} from './helpers.js';
let db,runtime,app;
before(async()=>{
  ({db,runtime}=await prepare());
  await db.query("INSERT INTO category(name) VALUES('Study help'),('Tech help')");await db.query("INSERT INTO skill(name) VALUES('SQL'),('Writing')");
  app=createApp(runtime,{secret:'test-only-session-secret-at-least-32-characters'});
});
after(async()=>{app?.locals.store.close();await db?.end();await runtime?.end();});
async function session(agent){return (await agent.get('/api/session').expect(200)).body.csrf;}
async function login() {
  return signIn(await student(db));
}
async function signIn(uid) {
  const [[u]]=await db.execute('SELECT campus_email FROM app_user WHERE user_id=?',[uid]);
  const agent=request.agent(app);let csrf=await session(agent);
  const response=await agent.post('/api/auth/login').set('X-CSRF-Token',csrf).send({email:u.campus_email,password:'CampusDemo!2026'}).expect(200);
  return {agent,csrf:response.body.csrf,uid};
}
const send=(agent,method,path,csrf,body)=>agent[method](path).set('X-CSRF-Token',csrf).send(body);

test('registration, login, current user, cookie flags, session rotation and logout',async()=>{
  const agent=request.agent(app);const csrf=await session(agent);
  const register=await send(agent,'post','/api/auth/register',csrf,{email:'  FRESH@Tests.Campus.Test ',displayName:'Fresh Student',password:'TestCampus!2026'}).expect(201);
  assert.equal(register.body.user.role,'STUDENT');assert.equal(register.body.user.campus_email,'fresh@tests.campus.test');assert.equal(register.body.user.password_hash,undefined);
  assert.notEqual(register.body.csrf,csrf);assert.ok(register.headers['set-cookie'][0].includes('HttpOnly'));assert.ok(register.headers['set-cookie'][0].includes('SameSite=Lax'));
  const profile=await agent.get('/api/profile').expect(200);assert.equal(profile.body.availablePoints,100);
  const me=await agent.get('/api/session').expect(200);assert.equal(me.body.user.display_name,'Fresh Student');
  const [[stored]]=await db.query("SELECT password_hash FROM app_user WHERE campus_email='fresh@tests.campus.test'");assert.notEqual(stored.password_hash,'TestCampus!2026');assert.ok(await bcrypt.compare('TestCampus!2026',stored.password_hash));
  await send(agent,'post','/api/auth/logout',register.body.csrf,{}).expect(204);await agent.get('/api/profile').expect(401);
  assert.equal((await agent.get('/api/session')).body.user,null);
});
test('invalid credentials, duplicate email, role injection, password validation and protected endpoints',async()=>{
  const agent=request.agent(app),csrf=await session(agent);
  const base={email:'valid@tests.campus.test',displayName:'Student',password:'TestCampus!2026'};
  await send(agent,'post','/api/auth/register',csrf,{...base,role:'ADMIN'}).expect(400);
  await send(agent,'post','/api/auth/register',csrf,{...base,password:'short'}).expect(400);
  await send(agent,'post','/api/auth/login',csrf,{email:base.email,password:base.password}).expect(401);
  await send(agent,'post','/api/auth/login',csrf,{email:'fresh@tests.campus.test',password:'WrongPassword'}).expect(401);
  await send(agent,'post','/api/auth/register',csrf,{...base,email:'fresh@tests.campus.test'}).expect(409);
  await agent.get('/api/profile').expect(401);await agent.get('/api/quests?mine=posted').expect(401);
  await send(agent,'post','/api/quests',csrf,{}).expect(401);
});
test('CSRF rejects missing/stale tokens and logout invalidates the previous cookie',async()=>{
  const {agent,csrf}=await login();
  await agent.put('/api/profile').send({displayName:'Changed',skillIds:[]}).expect(403);
  await send(agent,'put','/api/profile','stale',{displayName:'Changed',skillIds:[]}).expect(403);
  await send(agent,'post','/api/auth/logout',csrf,{}).expect(204);
  await send(agent,'put','/api/profile',csrf,{displayName:'Changed',skillIds:[]}).expect(403);
});
test('profile owns identity; updates skills; rejects forbidden edits and rolls back bad skills',async()=>{
  const {agent,csrf,uid}=await login();
  await send(agent,'put','/api/profile',csrf,{displayName:'A student',skillIds:[1,2]}).expect(200);
  const profile=(await agent.get('/api/profile').expect(200)).body;assert.equal(profile.skills.length,2);assert.equal(String(profile.user.user_id),uid);
  await send(agent,'put','/api/profile',csrf,{displayName:'Other',skillIds:[],userId:999}).expect(403);
  await send(agent,'put','/api/profile',csrf,{displayName:'Other',skillIds:[],role:'ADMIN'}).expect(403);
  await send(agent,'put','/api/profile',csrf,{displayName:'Bad skill',skillIds:[999]}).expect(400);
  await send(agent,'put','/api/profile',csrf,{displayName:'Duplicate',skillIds:[1,1]}).expect(400);
  assert.equal((await agent.get('/api/profile')).body.user.display_name,'A student');
});
test('board joins details; title search, category/state filters, pagination and invalid query values',async()=>{
  const a=await student(db);
  for(let i=0;i<8;i++)await post(db,a,1,`Find calculus notes ${i}`);
  const first=await request(app).get('/api/quests?search=calculus&category=1&state=OPEN').expect(200);
  assert.equal(first.body.total,8);assert.equal(first.body.quests.length,6);assert.equal(first.body.quests[0].category_name,'Study help');assert.ok(first.body.quests[0].poster_name);
  const second=await request(app).get('/api/quests?search=calculus&page=2').expect(200);assert.equal(second.body.quests.length,2);
  const ids=new Set([...first.body.quests,...second.body.quests].map(x=>x.quest_id));assert.equal(ids.size,8);
  const none=await request(app).get('/api/quests?search=calculus&category=2').expect(200);assert.equal(none.body.total,0);
  const detail=await request(app).get('/api/quests/'+first.body.quests[0].quest_id).expect(200);assert.equal(String(detail.body.poster_id),a);
  for(const query of ['state=HACKED','page=-1','page=10001','category=0','search='+('x'.repeat(101))])await request(app).get('/api/quests?'+query).expect(400);
  await request(app).get('/api/quests/999999').expect(404);await request(app).get('/api/quests/not-an-id').expect(400);
  assert.equal((await request(app).get('/api/quests?search=%27%20OR%201%3D1')).body.total,0);
});
test('posting validation, UTC deadline, real reserve, identity binding and insufficient funds',async()=>{
  const {agent,csrf,uid}=await login();
  const base={title:'Help with a join',description:'A small local request.',categoryId:1,rewardPoints:30,deadline:future().toISOString().replace('Z','+05:30')};
  const response=await send(agent,'post','/api/quests',csrf,base).expect(201);assert.equal(await balance(db,uid),70);
  const q=(await agent.get('/api/quests/'+response.body.quest_id)).body;assert.equal(String(q.poster_id),uid);assert.equal(new Date(q.deadline).getTime(),new Date(base.deadline).getTime());
  const own=(await agent.get('/api/quests?mine=posted')).body;assert.ok(own.quests.some(q=>q.quest_id===response.body.quest_id));
  await send(agent,'post','/api/quests',csrf,{...base,posterId:999}).expect(403);
  for(const patch of [{rewardPoints:0},{rewardPoints:1.5},{rewardPoints:'30'},{deadline:'2000-01-01T12:00:00Z'},{deadline:'2027-01-01T12:00'},{deadline:'2027-02-30T12:00:00Z'},{deadline:'2027-01-01T24:00:00Z'},{title:''},{title:'x'.repeat(141)},{categoryId:999},{categoryId:999999999999}])await send(agent,'post','/api/quests',csrf,{...base,...patch}).expect(400);
  const failed=await send(agent,'post','/api/quests',csrf,{...base,rewardPoints:71}).expect(409);assert.match(failed.body.error,/points/i);assert.equal(await balance(db,uid),70);
});
test('claiming conflicts, authenticated helper, own accepted list and persistence on repeated reads',async()=>{
  const a=await login(),b=await login(),c=await login();const q=await post(db,a.uid);
  await send(a.agent,'post',`/api/quests/${q}/claim`,a.csrf,{}).expect(409);
  await send(b.agent,'post',`/api/quests/${q}/claim`,b.csrf,{helperId:c.uid}).expect(400);
  const results=await Promise.all([send(b.agent,'post',`/api/quests/${q}/claim`,b.csrf,{}),send(c.agent,'post',`/api/quests/${q}/claim`,c.csrf,{})]);assert.deepEqual(results.map(x=>x.status).sort(),[201,409]);
  const winner=results[0].status===201?b:c;
  for(let i=0;i<2;i++) {
    const detail=(await winner.agent.get('/api/quests/'+q).expect(200)).body;assert.equal(String(detail.helper_id),winner.uid);assert.equal(detail.state,'CLAIMED');
    assert.ok((await winner.agent.get('/api/quests?mine=accepted')).body.quests.some(x=>String(x.quest_id)===q));
    assert.equal(String((await winner.agent.get('/api/session')).body.user.user_id),winner.uid);
  }
});
test('user text is stored as text; frontend uses safe DOM; errors omit SQL/hashes',async()=>{
  const {agent,csrf}=await login();
  const response=await send(agent,'post','/api/quests',csrf,{title:'<img src=x onerror=alert(1)>',description:'<script>window.bad=true</script>',categoryId:1,rewardPoints:1,deadline:future().toISOString()}).expect(201);
  const detail=(await agent.get('/api/quests/'+response.body.quest_id)).body;assert.match(detail.title,/<img/);
  const js=await request(app).get('/js/app.js').expect(200);assert.ok(!js.text.includes('innerHTML'));assert.ok(js.text.includes('textContent'));
  const page=await request(app).get('/').expect(200);assert.match(page.headers['content-security-policy'],/script-src 'self'/);
  const error=await request(app).get('/api/quests/999999').expect(404);assert.deepEqual(Object.keys(error.body),['error']);assert.ok(!error.text.includes('SELECT'));
  await request(app).get('/api/wallet').expect(401);
  for(const path of ['/api/chat','/api/admin','/api/unknown'])await request(app).get(path).expect(404);
});

test('full website lifecycle submits, approves exactly once, pays the helper and records a review',async()=>{
  const a=await login(),b=await login(),outsider=await login(),q=await post(db,a.uid,20);
  const act=(actor,action,body)=>send(actor.agent,'post',`/api/quests/${q}/${action}`,actor.csrf,body);
  await act(b,'claim',{}).expect(201);
  await act(outsider,'submit',{evidence:'Not my work'}).expect(409);
  await act(b,'submit',{evidence:' '}).expect(400);
  const submission=await act(b,'submit',{evidence:'Checked the joins together and explained the output.'}).expect(201);
  await outsider.agent.get(`/api/quests/${q}/submissions`).expect(409);
  await request(app).get(`/api/quests/${q}/submissions`).expect(401);
  assert.equal((await a.agent.get(`/api/quests/${q}/submissions`)).body[0].evidence_text,'Checked the joins together and explained the output.');
  await act(b,'approve',{submissionId:submission.body.submission_id}).expect(409);
  await act(a,'rating',{score:5,comment:'Too early'}).expect(400);
  await act(a,'approve',{submissionId:submission.body.submission_id}).expect(201);
  await act(a,'approve',{submissionId:submission.body.submission_id}).expect(409);
  assert.equal(await balance(db,a.uid),80);assert.equal(await balance(db,b.uid),120);
  await act(a,'rating',{score:6}).expect(400);
  await act(b,'rating',{score:5}).expect(409);
  await act(a,'rating',{score:5,comment:'Patient explanation of the duplicate rows.'}).expect(201);
  await act(a,'rating',{score:5}).expect(409);
  const review=(await request(app).get(`/api/quests/${q}/rating`).expect(200)).body;assert.equal(review.score,5);
  const wallet=(await b.agent.get('/api/wallet').expect(200)).body;assert.equal(wallet.balance,120);
  assert.ok(wallet.history.some(t=>t.kind==='PAYOUT' && Number(t.points)===20 && String(t.quest_id)===q));
  const leaders=(await request(app).get('/api/leaderboard').expect(200)).body;
  const person=leaders.find(p=>String(p.user_id)===b.uid);assert.equal(Number(person.earned_points),20);assert.equal(Number(person.average_score),5);
  await invariants(db);
});

test('open request cancellation refunds once and rejects another requester',async()=>{
  const a=await login(),b=await login(),q=await post(db,a.uid,15);
  await send(b.agent,'post',`/api/quests/${q}/cancel`,b.csrf,{}).expect(409);
  await send(a.agent,'post',`/api/quests/${q}/cancel`,a.csrf,{posterId:b.uid}).expect(400);
  await send(a.agent,'post',`/api/quests/${q}/cancel`,a.csrf,{}).expect(201);
  await send(a.agent,'post',`/api/quests/${q}/cancel`,a.csrf,{}).expect(409);
  assert.equal(await balance(db,a.uid),100);
  const wallet=(await a.agent.get('/api/wallet')).body;
  assert.deepEqual(wallet.history.map(x=>x.kind),['REFUND','RESERVE','GRANT']);
  await invariants(db);
});

test('public comments are paginated while chat remains private, ordered and cursor based',async()=>{
  const a=await login(),b=await login(),outsider=await login(),reviewer=await signIn(await admin(db)),q=await post(db,a.uid);
  await send(b.agent,'post',`/api/quests/${q}/claim`,b.csrf,{}).expect(201);
  await send(a.agent,'post',`/api/quests/${q}/comments`,a.csrf,{body:'<script>still plain text</script>'}).expect(201);
  for(let i=0;i<20;i++)await send(b.agent,'post',`/api/quests/${q}/comments`,b.csrf,{body:'Question '+i}).expect(201);
  assert.equal((await request(app).get(`/api/quests/${q}/comments`)).body.length,20);
  const second=(await request(app).get(`/api/quests/${q}/comments?page=2`)).body;assert.equal(second.length,1);assert.match(second[0].body,/<script>/);
  await send(a.agent,'post',`/api/quests/${q}/messages`,a.csrf,{body:'Meet in the library at four?'}).expect(201);
  const first=(await b.agent.get(`/api/quests/${q}/messages`).expect(200)).body;
  await send(b.agent,'post',`/api/quests/${q}/messages`,b.csrf,{body:'Yes, near the computer section.'}).expect(201);
  const next=(await a.agent.get(`/api/quests/${q}/messages?after=${first[0].message_id}`).expect(200)).body;assert.equal(next.length,1);assert.equal(String(next[0].sender_id),b.uid);
  for(const actor of [outsider,reviewer]) {
    await actor.agent.get(`/api/quests/${q}/messages`).expect(409);
    await send(actor.agent,'post',`/api/quests/${q}/messages`,actor.csrf,{body:'Private?'}).expect(409);
  }
  await send(a.agent,'post',`/api/quests/${q}/messages`,a.csrf,{body:'x'.repeat(2001)}).expect(400);
  await b.agent.get(`/api/quests/${q}/messages?after=-1`).expect(400);
});

test('dispute freezes payout, independent admin claims it, resume permits approval',async()=>{
  const a=await login(),b=await login(),outsider=await login(),reviewer=await signIn(await admin(db)),other=await signIn(await admin(db)),q=await post(db,a.uid,10);
  const act=(actor,action,body)=>send(actor.agent,'post',`/api/quests/${q}/${action}`,actor.csrf,body);
  await act(b,'claim',{}).expect(201);
  const submission=await act(b,'submit',{evidence:'Draft explanation of the keys.'}).expect(201);
  await act(outsider,'dispute',{reason:'I am not a participant.'}).expect(409);
  await act(a,'dispute',{reason:'Please check which tables the example should cover.'}).expect(201);
  await outsider.agent.get(`/api/quests/${q}/dispute`).expect(409);
  await act(a,'approve',{submissionId:submission.body.submission_id}).expect(409);
  await a.agent.get('/api/admin/disputes').expect(403);await request(app).get('/api/admin/disputes').expect(401);
  const queue=(await reviewer.agent.get('/api/admin/disputes').expect(200)).body;assert.ok(queue.some(d=>String(d.quest_id)===q));
  await reviewer.agent.get(`/api/quests/${q}/submissions`).expect(200);
  const path=`/api/admin/disputes/${q}`;
  await send(reviewer.agent,'post',path+'/assign',reviewer.csrf,{}).expect(200);
  await send(other.agent,'post',path+'/assign',other.csrf,{}).expect(409);
  await send(other.agent,'post',path+'/resolve',other.csrf,{decision:'RESUME',note:'Not assigned'}).expect(409);
  await send(reviewer.agent,'post',path+'/resolve',reviewer.csrf,{decision:'PAYOUT',note:'Bad choice'}).expect(400);
  await send(reviewer.agent,'post',path+'/resolve',reviewer.csrf,{decision:'RESUME',note:'Both agreed to cover the three main tables.'}).expect(200);
  assert.equal((await a.agent.get(`/api/quests/${q}/dispute`)).body.status,'RESOLVED');
  await act(a,'approve',{submissionId:submission.body.submission_id}).expect(201);
  assert.equal(await balance(db,b.uid),110);await invariants(db);
});

test('admin refund cancels disputed work and cannot settle twice; private reads check identity',async()=>{
  const a=await login(),b=await login(),reviewer=await signIn(await admin(db)),q=await post(db,a.uid,25);
  await send(b.agent,'post',`/api/quests/${q}/claim`,b.csrf,{}).expect(201);
  await send(b.agent,'post',`/api/quests/${q}/dispute`,b.csrf,{reason:'We cannot meet before the lab closes.'}).expect(201);
  const path=`/api/admin/disputes/${q}`;
  await send(a.agent,'post',path+'/assign',a.csrf,{}).expect(403);
  await send(reviewer.agent,'post',path+'/assign',reviewer.csrf,{}).expect(200);
  await send(reviewer.agent,'post',path+'/resolve',reviewer.csrf,{decision:'REFUND',note:''}).expect(400);
  await send(reviewer.agent,'post',path+'/resolve',reviewer.csrf,{decision:'REFUND',note:'Cancel the request as both students are unavailable.'}).expect(200);
  await send(reviewer.agent,'post',path+'/resolve',reviewer.csrf,{decision:'REFUND',note:'Again'}).expect(409);
  assert.equal((await a.agent.get('/api/quests/'+q)).body.state,'CANCELLED');
  assert.equal(await balance(db,a.uid),100);assert.equal(await balance(db,b.uid),100);
  for(const url of ['/api/wallet?page=0','/api/leaderboard?page=10001',`/api/quests/${q}/comments?page=-1`])await a.agent.get(url).expect(400);
  await invariants(db);
});
test('malformed JSON produces readable client error',async()=>{
  const response=await request(app).post('/api/auth/login').set('Content-Type','application/json').send('{invalid').expect(400);
  assert.ok(response.body.error);assert.ok(!response.text.includes('stack'));
});
