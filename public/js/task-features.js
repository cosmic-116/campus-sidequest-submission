import { el, button, date, actionForm, fold, pagedList } from './ui.js';
import { mountChat } from './chat.js';

export async function taskFeatures(q, target, {api,user,refresh,toast}) {
  const base='/quests/'+q.quest_id,poster=String(user?.user_id)===String(q.poster_id);
  const helper=String(user?.user_id)===String(q.helper_id),participant=poster || helper;
  const canRead=Boolean(q.claim_id && (participant || user?.role==='ADMIN'));
  const write=async(path,body,message)=>{
    await api(base+'/'+path,{method:'POST',body:JSON.stringify(body)});toast(message);await refresh();
  };
  try {
    const [rating,dispute]=await Promise.all([api(base+'/rating'),canRead?api(base+'/dispute'):null]);
    if(!target.isConnected || target.closest('[hidden]'))return;
    const frozen=dispute && dispute.status!=='RESOLVED';
    if(poster && q.state==='OPEN') {
      const box=el('section',undefined,'feature-section');
      box.append(actionForm('No longer need help?',[],'Cancel request and return points',()=>write('cancel',{},'Request cancelled. Your points have been returned.')));
      target.append(box);
    }
    if(helper && ['CLAIMED','SUBMITTED'].includes(q.state)) {
      const box=el('section',undefined,'feature-section');
      box.append(actionForm(q.state==='SUBMITTED'?'Update your work summary':'Finished helping?',[
        {name:'evidence',label:'What did you complete?',type:'textarea',max:5000}
      ],'Send work for approval',body=>write('submit',body,'Work sent. The requester can now approve it.')));target.append(box);
    }
    if(canRead) {
      const work=fold('Work summaries',async body=>{
        await pagedList(body,page=>api(base+'/submissions?page='+page),s=>{
          const row=el('article',undefined,'record');
          row.append(el('p',s.evidence_text,'message-body'),el('p',date(s.submitted_at)+(s.approved_at?' · Approved':''),'muted'));
          if(poster && q.state==='SUBMITTED' && !frozen)row.append(actionForm('',[],'Approve this work and pay '+q.reward_points+' points',()=>write('approve',{submissionId:s.submission_id},'Work approved. Points paid to the helper.')));
          return row;
        });
      });
      target.append(work);work.open=q.state==='SUBMITTED';
    }
    if(rating) {
      const box=el('section',undefined,'feature-section');box.append(el('h2','Helper review'),el('p',`${rating.score} out of 5`));
      if(rating.comment)box.append(el('p',rating.comment,'message-body'));target.append(box);
    } else if(poster && q.state==='COMPLETED') {
      const box=el('section',undefined,'feature-section');
      box.append(actionForm('How was the help?',[
        {name:'score',label:'Rating',options:[[5,'5 — Excellent'],[4,'4 — Good'],[3,'3 — Okay'],[2,'2 — Could be better'],[1,'1 — Poor']]},
        {name:'comment',label:'A short review (optional)',type:'textarea',max:1000,required:false}
      ],'Save helper review',body=>write('rating',{...body,score:Number(body.score)},'Thanks. Your review has been saved.')));target.append(box);
    }
    if(dispute) {
      const box=el('section',undefined,'feature-section dispute-note');
      box.append(el('h2',frozen?'Dispute under review':'Dispute resolved'),el('p',dispute.reason,'message-body'));
      box.append(el('p',frozen?'Approval and payout are paused until an admin resolves this.':dispute.decision==='REFUND'?'The requester’s points were returned.':'Work may continue.','muted'));
      if(dispute.resolution_note)box.append(el('p',dispute.resolution_note,'message-body'));target.append(box);
    } else if(participant && ['CLAIMED','SUBMITTED'].includes(q.state)) {
      target.append(fold('Need an admin to help?',body=>body.append(actionForm('Raise a dispute',[
        {name:'reason',label:'What needs to be resolved?',type:'textarea'}
      ],'Send dispute to admin',body=>write('dispute',body,'Dispute sent. Settlement is paused for review.')))));
    }
    if(participant && q.claim_id)mountChat(q,{api,user});
    const comments=fold('Public comments',async body=>{
      const list=el('div');body.append(list);
      const load=()=>pagedList(list,page=>api(base+'/comments?page='+page),c=>{
        const row=el('article',undefined,'record');row.append(el('strong',c.author_name),el('p',c.body,'message-body'),el('small',date(c.created_at)));return row;
      });
      await load();
      if(user?.role==='STUDENT')body.append(actionForm('',[{name:'body',label:'Add a public comment',type:'textarea',max:1000}],'Post comment',async fields=>{
        await api(base+'/comments',{method:'POST',body:JSON.stringify(fields)});body.querySelector('form').reset();list.replaceChildren();await load();
      }));
      else body.append(el('p',user?'Students can leave public comments.':'Log in to leave a comment.','muted'));
    });
    comments.classList.add('task-discussion');target.append(comments);
    for(const section of target.children)if(section!==comments)section.classList.add('task-work');
  }catch(e){target.replaceChildren(el('p',e.message),button('Retry task actions',refresh));}
}
