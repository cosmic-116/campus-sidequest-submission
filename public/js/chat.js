import {el,button,date} from './ui.js';

let dispose=()=>{};
export function closeChat() { dispose();dispose=()=>{}; }

// Short polling keeps both the MySQL and Sites versions small and explainable.
export function mountChat(q,{api,user}) {
  closeChat();
  const peer=String(user.user_id)===String(q.poster_id)?q.helper_name:q.poster_name;
  const root=el('div',undefined,'chat-widget'),panel=el('section',undefined,'chat-panel');
  panel.id='task-chat';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-labelledby','chat-title');
  const heading=el('div',undefined,'chat-heading'),title=el('h2','Chat with '+peer);title.id='chat-title';
  const minimize=button('×',()=>toggle(false),'chat-close');minimize.setAttribute('aria-label','Minimize chat');
  heading.append(title,minimize);
  const subject=el('p',q.title,'chat-subject'),status=el('p','Private to you and '+peer,'chat-status');status.setAttribute('role','status');
  const log=el('div',undefined,'chat-log');log.setAttribute('role','log');log.setAttribute('aria-label','Conversation');log.setAttribute('aria-live','polite');log.setAttribute('aria-relevant','additions');
  const form=el('form',undefined,'chat-form'),label=el('label','Message','sr-only'),input=el('textarea');
  input.id='chat-message';input.name='message';input.rows=2;input.required=true;input.maxLength=2000;input.placeholder='Write a message…';label.htmlFor=input.id;
  const send=el('button','Send','button');send.type='submit';
  const error=el('p','','chat-error');error.setAttribute('role','alert');form.append(label,input,send,error);
  const launcher=button('Chat with '+peer,()=>toggle(panel.hidden),'button chat-launcher');
  launcher.setAttribute('aria-controls',panel.id);launcher.setAttribute('aria-expanded','false');
  panel.append(heading,subject,log,status,form);root.append(panel,launcher);document.body.append(root);
  const controller=new AbortController();
  let after=0,timer,reading=false;
  function toggle(open) {
    panel.hidden=!open;launcher.hidden=open;launcher.setAttribute('aria-expanded',String(open));
    clearTimeout(timer);
    if(open){load();input.focus();}else launcher.focus();
  }
  async function load() {
    clearTimeout(timer);
    if(panel.hidden || document.hidden || reading || controller.signal.aborted)return;
    reading=true;let delay=2000;
    try {
      const rows=await api(`/quests/${q.quest_id}/messages`+(after?'?after='+after:''),{signal:controller.signal});
      if(controller.signal.aborted)return;
      const follow=log.scrollHeight-log.scrollTop-log.clientHeight<80;
      for(const m of rows) {
        if(Number(m.message_id)<=Number(after))continue;
        const mine=String(m.sender_id)===String(user.user_id),bubble=el('article',undefined,'chat-bubble'+(mine?' mine':''));
        bubble.append(el('strong',mine?'You':peer),el('p',m.body),el('small',date(m.sent_at)));log.append(bubble);after=m.message_id;
      }
      if(rows.length && follow)log.scrollTop=log.scrollHeight;
      const message=after?'Live · checks for new messages every 2 seconds':'No messages yet. Say hello to '+peer+'.';
      if(status.textContent!==message)status.textContent=message;
      if(rows.length===100)delay=100; // Catch up through the existing cursor pages.
    }catch(e){if(!controller.signal.aborted){status.textContent='Connection interrupted. Retrying…';delay=5000;}}
    finally {reading=false;if(!panel.hidden && !document.hidden && !controller.signal.aborted)timer=setTimeout(load,delay);}
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();const body=input.value.trim();
    if(!body)return;send.disabled=true;error.textContent='';
    try {
      await api(`/quests/${q.quest_id}/messages`,{method:'POST',body:JSON.stringify({body}),signal:controller.signal});
      if(controller.signal.aborted)return;
      input.value='';log.scrollTop=log.scrollHeight;await load();input.focus();
    }catch(e){if(!controller.signal.aborted)error.textContent=e.message;}
    finally {send.disabled=false;}
  });
  panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();toggle(false);}});
  const visibility=()=>{clearTimeout(timer);if(!document.hidden)load();};
  document.addEventListener('visibilitychange',visibility);
  dispose=()=>{clearTimeout(timer);controller.abort();document.removeEventListener('visibilitychange',visibility);root.remove();};
}
