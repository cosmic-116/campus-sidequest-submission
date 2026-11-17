import { el, button, date } from './ui.js';
import { taskFeatures } from './task-features.js';
import { accountPage } from './account-features.js';
import { closeChat } from './chat.js';
const $ = selector => document.querySelector(selector);
const state = { user:null, csrf:'', catalog:{categories:[],skills:[]}, mode:'board', page:1, register:false, request:0 };
async function api(url, options={}) {
  const response=await fetch('/api'+url,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json','X-CSRF-Token':state.csrf,...options.headers}});
  const data=response.status===204 ? {} : await response.json();
  if(!response.ok) throw new Error(data.error || 'The request could not be completed.');
  return data;
}
function toast(message) {
  $('#toast').textContent=message; $('#toast').hidden=false;
  clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,4500);
}
function showAuth() { setAuthMode(false); $('#auth-dialog').showModal(); }
function setAuthMode(register) {
  state.register=register;
  $('#auth-form').reset(); $('#auth-form .form-error').textContent='';
  $('#name-field').hidden=!register; $('#name-field input').required=register;
  $('#auth-form [name=password]').autocomplete=register?'new-password':'current-password';
  $('#auth-heading').textContent=register?'Create your account':'Log in';
  $('#auth-copy').textContent=register?'Create a student account with 100 starter points.':'Log in to post requests or offer your help.';
  $('#auth-submit').textContent=register?'Create my account':'Log in';
  $('#auth-switch-copy').textContent=register?'Already have an account?':'New around here?';
  $('#auth-switch').textContent=register?'Log in':'Create an account';
}
function identity() {
  $('#admin-link').hidden=state.user?.role!=='ADMIN';
  $('#wallet-link').hidden=!state.user || state.user.role!=='STUDENT';
  $('#post-open').hidden=state.user?.role==='ADMIN';
  const container=$('#identity'); container.replaceChildren();
  if(!state.user) {const login=button('Log in / join',showAuth,'button small');login.id='login-open';container.append(login);return;}
  const link=el('a',state.user.display_name);link.href=state.user.role==='ADMIN'?'#admin':'#profile';
  container.append(link,button('Log out',async()=>{
    try {await api('/auth/logout',{method:'POST',body:'{}'});state.user=null;const session=await api('/session');state.csrf=session.csrf;identity();location.hash='board';await renderRoute();toast('You’re logged out. See you around.');}
    catch(e){toast(e.message);}
  },'logout'));
}
function categoryOptions() {
  for(const category of state.catalog.categories) {
    for(const selector of ['#category-filter','#post-category']) {
      const option=el('option',category.name);option.value=category.category_id;$(selector).append(option);
    }
  }
}
function card(q) {
  const article=el('article',undefined,'task-card');
  // Fixed visual themes: user content never becomes a CSS class or HTML.
  const themes={'Study help':'violet','Tech help':'blue','Borrow & share':'amber','Practice together':'rose','Around campus':'green'};
  article.dataset.theme=themes[q.category_name] || 'violet';
  const top=el('div',undefined,'card-top');
  const points=el('span',String(q.reward_points),'points');points.append(el('small','pts'));
  top.append(el('span',q.category_name,'category-tag'),points);
  const heading=el('h3'),link=el('a',q.title);link.href=`#task/${q.quest_id}`;heading.append(link);
  const summary=q.description.length>130?q.description.slice(0,127)+'…':q.description;
  const bottom=el('div',undefined,'card-bottom'),person=el('span',undefined,'person');
  person.append(el('span',q.poster_name.split(/\s+/).map(x=>x[0]).slice(0,2).join(''),'avatar'),el('span',q.poster_name));
  bottom.append(person,el('span',q.state.replaceAll('_',' '),'state-label'));
  article.append(top,heading,el('p',summary,'card-description'),bottom);return article;
}
async function loadBoard() {
  const request=++state.request;
  const list=$('#task-list'); list.replaceChildren(el('p','Loading requests…','empty'));
  $('#previous').disabled=true;$('#next').disabled=true;
  const query=new URLSearchParams({page:state.page});
  for(const key of ['search','category','state']) if($('#filters').elements[key].value) query.set(key,$('#filters').elements[key].value);
  if(state.mode!=='board') query.set('mine',state.mode);
  try {
    const data=await api('/quests?'+query);
    if(request!==state.request)return;
    list.replaceChildren(...data.quests.map(card));
    if(!data.quests.length) list.append(el('p',state.mode==='board'?'No requests here yet. Try another filter, or be the first to ask.':state.mode==='posted'?'You haven’t posted a matching request yet. Small favours are a good place to start.':'No matching tasks yet. Pick something from the board when you’re ready.','empty'));
    $('#result-count').textContent=`${data.total} ${data.total===1?'request':'requests'}`;
    $('#page-label').textContent=`Page ${data.page} of ${Math.max(1,Math.ceil(data.total/data.pageSize))}`;
    $('#previous').disabled=data.page<=1;$('#next').disabled=data.page*data.pageSize>=data.total;
    $('.pagination').hidden=data.total<=data.pageSize;
  } catch(e) {
    if(request!==state.request)return;
    const message=el('div',undefined,'empty');message.append(el('p',e.message),button('Try again',loadBoard));list.replaceChildren(message);$('#result-count').textContent='Couldn’t load tasks';
  }
}
async function loadProfile() {
  $('#profile-form .form-error').textContent='Loading your profile…';
  try {
    const data=await api('/profile');
    $('#profile-greeting').textContent=data.user.display_name.split(' ')[0];
    $('#profile-form').elements.displayName.value=data.user.display_name;
    $('#profile-form').elements.email.value=data.user.campus_email;
    $('#profile-points').textContent=data.availablePoints;
    $('#skill-options').replaceChildren();
    for(const skill of state.catalog.skills) {
      const label=el('label'),input=document.createElement('input');input.type='checkbox';input.name='skill';input.value=skill.skill_id;
      input.checked=data.skills.some(x=>x.skill_id===skill.skill_id);label.append(input,document.createTextNode(skill.name));$('#skill-options').append(label);
    }
    $('#profile-form .form-error').textContent='';
  }catch(e){$('#profile-form .form-error').textContent=e.message;}
}
async function loadDetail(id) {
  closeChat();
  const target=$('#detail-view');target.replaceChildren(el('p','Loading task…','empty'));
  try {
    const q=await api('/quests/'+encodeURIComponent(id));
    if(location.hash!==`#task/${id}`)return;
    const back=el('a','← Back to the board','back-link');back.href='#board';
    const layout=el('div',undefined,'detail-layout'),paper=el('article',undefined,'paper'),aside=el('aside',undefined,'points-card');
    paper.append(el('span',q.category_name,'category-tag'),el('h1',q.title),el('span',q.state,'state-label'),requestDescription(q.description));
    const meta=el('div',undefined,'detail-meta');
    meta.append(el('p',`Requested by ${q.poster_name}`),el('p',`Accept by ${date(q.deadline)} (your time)`),el('p',`Posted ${date(q.created_at)}`));
    if(q.helper_name)meta.append(el('p',`Helper: ${q.helper_name}`));paper.append(meta);
    aside.append(el('p','POINTS OFFERED','eyebrow'),el('strong',String(q.reward_points)),el('p','campus points'),el('hr'));
    const canAccept=q.state==='OPEN' && new Date(q.deadline)>new Date() && state.user?.role!=='ADMIN' && String(state.user?.user_id)!==String(q.poster_id);
    if(canAccept) aside.append(button(state.user?'Accept this request':'Log in to accept',async event=>{
      if(!state.user)return showAuth();
      const control=event.currentTarget;control.disabled=true;
      try {await api(`/quests/${q.quest_id}/claim`,{method:'POST',body:'{}'});toast('It’s yours. You’re now listed as the helper.');await loadDetail(q.quest_id);}
      catch(e){toast(e.message);await loadDetail(q.quest_id);}
    },'button'));
    else aside.append(el('p',String(state.user?.user_id)===String(q.poster_id)?'This is your request. You can find it under My requests.':q.state==='OPEN'?'The deadline for accepting this task has passed.':'This task is no longer available to accept.','detail-help'));
    layout.append(paper,aside);target.replaceChildren(back,layout);
    const extras=el('div',undefined,'task-features');target.append(extras);
    await taskFeatures(q,extras,{api,user:state.user,refresh:()=>loadDetail(id),toast});
  }catch(e){target.replaceChildren(el('p',e.message,'empty'),button('Try again',()=>loadDetail(id)));}
}
function requestDescription(body) {
  const group=el('div',undefined,'description-group');
  if(body.length<=500) {
    group.append(el('p',body,'detail-description'));
    return group;
  }
  // Keep a real text preview; the complete text is hidden until requested.
  const preview=el('p',body.slice(0,500).trimEnd()+'…','detail-description');
  const full=el('p',body,'detail-description');
  full.hidden=true;
  full.id='full-request-description';
  let expanded=false;
  const toggle=button('Read full request',()=>{
    expanded=!expanded;
    preview.hidden=expanded;
    full.hidden=!expanded;
    toggle.textContent=expanded?'Show less':'Read full request';
    toggle.setAttribute('aria-expanded',String(expanded));
  },'button quiet description-toggle');
  toggle.setAttribute('aria-expanded','false');
  toggle.setAttribute('aria-controls',full.id);
  group.append(preview,full,toggle);
  return group;
}
async function renderRoute() {
  closeChat();
  const route=location.hash.slice(1)||'board';
  const [view,taskId]=route.split('/');
  const isProfile=view==='profile',isDetail=view==='task';
  const isAccount=['wallet','leaderboard','admin'].includes(view);
  $('#board-view').hidden=isProfile||isDetail||isAccount;$('#profile-view').hidden=!isProfile;$('#detail-view').hidden=!isDetail;
  $('#account-view').hidden=!isAccount;
  document.querySelectorAll('[data-nav]').forEach(a=>a.classList.toggle('active',a.dataset.nav===view));
  if((isProfile || ['posted','accepted','wallet','admin'].includes(view)) && !state.user) {
    if(isProfile){$('#profile-view').hidden=true;$('#board-view').hidden=false;}
    location.hash='board';showAuth();return;
  }
  if(isAccount)return accountPage(view,$('#account-view'),{api,user:state.user,toast});
  if(isProfile)return loadProfile();
  if(isDetail)return loadDetail(taskId);
  const mode=['posted','accepted'].includes(view)?view:'board';
  if(mode!==state.mode) {state.page=1;$('#state-filter').value=mode==='board'?'OPEN':'';$('#search').value='';$('#category-filter').value='';}
  state.mode=mode;
  $('.intro').hidden=mode!=='board';
  $('#list-kicker').textContent=mode==='board'?'THE STUDENT TASK BOARD':mode==='posted'?'POSTED BY YOU':'ACCEPTED BY YOU';
  $('#board-heading').textContent=mode==='board'?'Campus requests':mode==='posted'?'My requests':'Tasks I’m helping with';
  await loadBoard();
}
async function openPost() {
  if(!state.user)return showAuth();
  if(state.user.role!=='STUDENT')return toast('Use a student account to post a request.');
  try {
    const data=await api('/profile');$('#post-points').textContent=data.availablePoints;$('#post-form .form-error').textContent='';
    const local=new Date(Date.now()+24*60*60*1000);local.setMinutes(local.getMinutes()-local.getTimezoneOffset());
    $('#post-form').elements.deadline.value=local.toISOString().slice(0,16);
    $('#post-dialog').showModal();
  }catch(e){toast(e.message);}
}
async function formAction(form, action) {
  const submit=form.querySelector('button[type=submit],button:not([type])');submit.disabled=true;
  form.querySelector('.form-error').textContent='';
  try {await action();}catch(e){form.querySelector('.form-error').textContent=e.message;}finally{submit.disabled=false;}
}
$('#auth-form').addEventListener('submit',event=>{
  event.preventDefault();const form=event.currentTarget;
  formAction(form,async()=>{
    const fields=new FormData(form),payload={email:fields.get('email'),password:fields.get('password')};
    if(state.register)payload.displayName=fields.get('displayName');
    const data=await api('/auth/'+(state.register?'register':'login'),{method:'POST',body:JSON.stringify(payload)});
    state.user=data.user;state.csrf=data.csrf;identity();$('#auth-dialog').close();toast(`Welcome, ${state.user.display_name.split(' ')[0]}.`);await renderRoute();
  });
});
$('#auth-switch').addEventListener('click',()=>setAuthMode(!state.register));
$('#profile-form').addEventListener('submit',event=>{
  event.preventDefault();const form=event.currentTarget;
  formAction(form,async()=>{
    const data=await api('/profile',{method:'PUT',body:JSON.stringify({displayName:form.elements.displayName.value,skillIds:[...form.querySelectorAll('[name=skill]:checked')].map(x=>Number(x.value))})});
    state.user=data.user;identity();toast('Profile saved.');await loadProfile();
  });
});
$('#post-form').addEventListener('submit',event=>{
  event.preventDefault();const form=event.currentTarget;
  formAction(form,async()=>{
    const fields=new FormData(form);
    await api('/quests',{method:'POST',body:JSON.stringify({title:fields.get('title'),description:fields.get('description'),categoryId:Number(fields.get('categoryId')),rewardPoints:Number(fields.get('rewardPoints')),deadline:new Date(fields.get('deadline')).toISOString()})});
    form.reset();$('#post-dialog').close();toast('Your request is up. The points are safely set aside.');
    state.page=1;$('#state-filter').value='';location.hash='posted';await renderRoute();
  });
});
$('#filters').addEventListener('submit',event=>{event.preventDefault();state.page=1;loadBoard();});
for(const selector of ['#category-filter','#state-filter'])$(selector).addEventListener('change',()=>{state.page=1;loadBoard();});
$('#previous').addEventListener('click',()=>{state.page--;loadBoard();});
$('#next').addEventListener('click',()=>{state.page++;loadBoard();});
$('#post-open').addEventListener('click',openPost);$('#profile-post').addEventListener('click',openPost);
document.querySelectorAll('[data-close]').forEach(x=>x.addEventListener('click',()=>document.getElementById(x.dataset.close).close()));
window.addEventListener('hashchange',renderRoute);
async function init() {
  try {
    const [session,catalog]=await Promise.all([api('/session'),api('/catalog')]);state.user=session.user;state.csrf=session.csrf;state.catalog=catalog;
    identity();categoryOptions();await renderRoute();
  }catch(e){$('#task-list').replaceChildren(el('p','Couldn’t reach the local server. '+e.message,'empty'),button('Try again',init));}
}
init();
