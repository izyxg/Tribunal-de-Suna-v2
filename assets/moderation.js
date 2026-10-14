(()=>{
  const API='/api/moderation';
  let overview=null,busy=false;
  const isManager=()=>['Gérant','Co-gérant'].includes(overview?.user?.role);
  const isJudge=()=>overview?.user?.role==='Magistrat';
  const tab=()=>document.querySelector('.side-nav .on')?.dataset.tab||'dashboard';
  const toast=(m,ok=true)=>{const t=document.getElementById('toast');if(!t)return alert(m);t.textContent=m;t.className=`toast ${ok?'ok':'bad'}`;t.hidden=false;clearTimeout(t._m);t._m=setTimeout(()=>t.hidden=true,4200)};
  const post=async(action,body={})=>{const r=await fetch(`${API}?action=${encodeURIComponent(action)}`,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(body)});const j=await r.json().catch(()=>({message:'Réponse modération invalide.'}));if(!r.ok||j.ok===false)throw new Error(j.message||'Action refusée.');return j};
  const load=async()=>{try{const r=await fetch('/api?action=overview',{credentials:'same-origin'});const j=await r.json();if(r.ok&&j.ok!==false)overview=j}catch{}};
  const reloadBack=()=>{sessionStorage.setItem('ts_return_tab',tab());setTimeout(()=>location.reload(),350)};
  const addButton=(row,label,action,id,confirmText)=>{
    if(!row||row.querySelector(`[data-mod-action="${action}"]`))return;
    let box=row.querySelector('.mod-actions');
    if(!box){box=document.createElement('div');box.className='inline-actions mod-actions';row.appendChild(box)}
    const b=document.createElement('button');b.type='button';b.className='danger mini';b.textContent=label;b.dataset.modAction=action;b.dataset.id=id;b.dataset.confirm=confirmText;box.appendChild(b);
  };
  const rowsFor=(title)=>{
    const cards=[...document.querySelectorAll('.card')];
    const card=cards.find(c=>c.querySelector('.section-title h2')?.textContent.trim().toLowerCase()===title.toLowerCase());
    return card?[...card.querySelectorAll('.row-item')]:[];
  };
  const enhance=async()=>{
    if(busy)return;busy=true;
    try{
      if(!overview)await load(); if(!overview?.user)return;
      const tasks=rowsFor('Tâches');
      tasks.forEach((r,i)=>{const id=r.querySelector('[data-action="task-status"]')?.dataset.id||overview.tasks?.[i]?.id;if(id)addButton(r,'Supprimer','delete-task',id,'Supprimer définitivement cette tâche ?')});
      const judgments=rowsFor('Jugements');
      if(isManager()||isJudge())judgments.forEach((r,i)=>{const id=overview.judgments?.[i]?.id;if(id)addButton(r,'Supprimer','delete-judgment',id,'Supprimer définitivement ce jugement ?')});
      const treasury=rowsFor('Historique');
      if(isManager())treasury.forEach((r,i)=>{const id=overview.treasury?.[i]?.id;if(id)addButton(r,'Supprimer','delete-treasury',id,'Supprimer cette opération ? Le solde sera recalculé.')});
      const inviteCard=[...document.querySelectorAll('.card')].find(c=>c.querySelector('.section-title h2')?.textContent.trim()==='Invitations récentes');
      if(inviteCard&&isManager()&&!inviteCard.querySelector('[data-mod-action="purge-invites"]')){
        const zone=inviteCard.querySelector('.section-title .inline-actions')||inviteCard.querySelector('.section-title');
        const b=document.createElement('button');b.type='button';b.className='ghost mini';b.textContent='Purger';b.dataset.modAction='purge-invites';b.dataset.confirm='Nettoyer les invitations expirées, utilisées ou révoquées ?';zone.appendChild(b);
      }
    }finally{busy=false}
  };
  document.addEventListener('click',async e=>{
    const b=e.target.closest('[data-mod-action]'); if(!b)return;
    e.preventDefault(); e.stopPropagation();
    if(b.dataset.confirm&&!confirm(b.dataset.confirm))return;
    b.disabled=true;
    try{await post(b.dataset.modAction,{id:b.dataset.id});toast('Action de modération effectuée.');reloadBack()}catch(err){toast(err.message,false);b.disabled=false}
  },true);
  const restore=()=>{const saved=sessionStorage.getItem('ts_return_tab');if(!saved)return;const btn=document.querySelector(`[data-tab="${CSS.escape(saved)}"]`);if(btn){sessionStorage.removeItem('ts_return_tab');btn.click()}};
  const schedule=()=>{restore();clearTimeout(window.__tsModTimer);window.__tsModTimer=setTimeout(enhance,180)};
  new MutationObserver(schedule).observe(document.getElementById('app')||document.body,{subtree:true,childList:true});
  window.addEventListener('load',schedule);document.addEventListener('DOMContentLoaded',schedule);
})();
