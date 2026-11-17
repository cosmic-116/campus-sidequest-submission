import { el, button, date, actionForm, pagedList } from './ui.js';

export async function accountPage(view, target, {api,user,toast}) {
  target.replaceChildren(el('h1',view==='wallet'?'Your points':view==='admin'?'Disputes':'Campus helpers','page-title'));
  if(view==='admin' && user?.role!=='ADMIN') {target.append(el('p','An admin account is required.'));return;}
  const content=el('section',undefined,'feature-section');target.append(content);
  if(view==='wallet') {
    const amount=el('h2');content.append(amount,el('p','Points set aside for open work return when you cancel, or go to your helper when you approve.','muted'));
    const list=el('div');content.append(list);
    return pagedList(list,async page=>{
      const data=await api('/wallet?page='+page);amount.textContent=data.balance+' available points';return data.history;
    },entry=>{
      const row=el('article',undefined,'record wallet-row'),labels={GRANT:'Starter points',RESERVE:'Set aside for a request',PAYOUT:'Earned by helping',REFUND:'Returned to you'};
      const info=el('div');info.append(el('strong',labels[entry.kind]));
      if(entry.quest_id){const link=el('a',entry.title);link.href='#task/'+entry.quest_id;info.append(link);}
      info.append(el('small',date(entry.created_at)));
      row.append(info,el('strong',(Number(entry.points)>0?'+':'')+entry.points+' pts',Number(entry.points)>0?'points-in':'points-out'));return row;
    });
  }
  if(view==='leaderboard') {
    content.append(el('p','Ranked by points earned from completed requests.','muted'));
    const list=el('div');content.append(list);let currentPage=1;
    return pagedList(list,page=>{currentPage=page;return api('/leaderboard?page='+page);},(person,index)=>{
      const row=el('article',undefined,'record wallet-row'),info=el('div');
      info.append(el('strong',`${(currentPage-1)*20+index+1}. ${person.display_name}`),el('p',`${person.completed_count} completed · ${Number(person.rating_count)?Number(person.average_score).toFixed(1)+' / 5 from '+person.rating_count+' reviews':'No reviews yet'}`,'muted'));
      row.append(info,el('strong',person.earned_points+' pts','points-in'));return row;
    });
  }
  content.append(button('Refresh disputes',()=>accountPage(view,target,{api,user,toast})));
  const list=el('div');content.append(list);
  return pagedList(list,page=>api('/admin/disputes?page='+page),d=>{
    const row=el('article',undefined,'record'),link=el('a',d.title);link.href='#task/'+d.quest_id;
    row.append(link,el('p',`${d.status.replaceAll('_',' ')} · Raised by ${d.raised_name}`,'muted'),el('p',d.reason,'message-body'));
    const write=async(path,body)=>{
      await api(`/admin/disputes/${d.quest_id}/${path}`,{method:'POST',body:JSON.stringify(body)});
      toast('Dispute updated.');await accountPage(view,target,{api,user,toast});
    };
    if(d.status==='OPEN')row.append(actionForm('',[],'Take this review',()=>write('assign',{})));
    if(d.status==='IN_REVIEW') {
      row.append(el('p','Assigned to '+d.admin_name,'muted'));
      if(String(d.assigned_admin)===String(user.user_id))row.append(actionForm('',[
        {name:'decision',label:'Decision',options:[['RESUME','Let the work continue'],['REFUND','Cancel and refund the requester']]},
        {name:'note',label:'Explain your decision',type:'textarea'}
      ],'Resolve dispute',body=>write('resolve',body)));
    }
    if(d.status==='RESOLVED')row.append(el('p',d.decision+': '+d.resolution_note,'message-body'));
    return row;
  });
}
