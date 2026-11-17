export const el = (tag, text, className) => {
  const node=document.createElement(tag);
  if(text!==undefined) node.textContent=text;
  if(className) node.className=className;
  return node;
};
export function button(label, action, className='button quiet small') {
  const node=el('button',label,className);node.type='button';node.addEventListener('click',action);return node;
}
export const date = value => new Date(value).toLocaleString(undefined,{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'});

// One small form builder keeps every workflow form labelled and consistent.
export function actionForm(title, fields, submitLabel, action) {
  const form=el('form',undefined,'action-form');
  if(title) form.append(el('h3',title));
  for(const field of fields) {
    const label=el('label',field.label),input=el(field.options?'select':field.type==='textarea'?'textarea':'input');
    input.name=field.name;input.required=field.required!==false;
    if(field.options) for(const [value,text] of field.options) {const option=el('option',text);option.value=value;input.append(option);}
    else if(field.type==='textarea') {input.rows=3;input.maxLength=field.max || 2000;}
    else {input.type=field.type || 'text';input.maxLength=field.max || 1000;}
    label.append(input);form.append(label);
  }
  const error=el('p','','form-error');error.setAttribute('role','alert');
  const submit=el('button',submitLabel,'button');submit.type='submit';form.append(error,submit);
  form.addEventListener('submit',async event=>{
    event.preventDefault();submit.disabled=true;error.textContent='';
    try {await action(Object.fromEntries(new FormData(form)));}
    catch(e) {error.textContent=e.message;}
    finally {submit.disabled=false;}
  });
  return form;
}

export function fold(title, load) {
  const details=el('details',undefined,'feature-section'),body=el('div');
  details.append(el('summary',title),body);
  let loaded=false;
  details.addEventListener('toggle',async()=>{
    if(!details.open || loaded)return;
    loaded=true;
    try {await load(body);}
    catch(e) {loaded=false;body.replaceChildren(el('p',e.message));}
  });
  return details;
}

// Lists use twenty rows per page; messages use their database cursor instead.
export function pagedList(target, read, render) {
  let page=1;
  const rows=el('div',undefined,'record-list'),nav=el('nav',undefined,'pagination'),label=el('span');
  nav.setAttribute('aria-label','List pages');
  const previous=button('Previous',()=>{page--;load();}),next=button('Next',()=>{page++;load();});
  nav.append(previous,label,next);target.append(rows,nav);
  async function load() {
    previous.disabled=true;next.disabled=true;
    try {
      const data=await read(page);
      rows.replaceChildren(...data.map(render));
      if(!data.length)rows.append(el('p','No entries on this page.','muted'));
      label.textContent='Page '+page;previous.disabled=page===1;next.disabled=data.length<20;
      nav.hidden=page===1 && data.length<20;
    }catch(e){rows.replaceChildren(el('p',e.message),button('Try again',load));}
  }
  return load();
}
