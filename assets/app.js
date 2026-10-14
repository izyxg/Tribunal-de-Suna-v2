const app = document.getElementById('app');
const toastBox = document.getElementById('toast');
const state = { user:null, data:null, needsSetup:false, inviteToken:null, invite:null, lastInviteUrl:'', tab:'dashboard', busy:false };
const roles = ['Gérant','Co-gérant','Magistrat','Greffier','Procureur','Avocat','Auditeur'];
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => (Number(n||0)).toLocaleString('fr-FR') + ' Ryō';
const date = v => v ? new Date(v).toLocaleDateString('fr-FR') : '—';
const isManager = () => ['Gérant','Co-gérant'].includes(state.user?.role);
const isGerant = () => state.user?.role === 'Gérant';
const canJudge = () => state.user && state.user.role !== 'Auditeur';
const params = new URLSearchParams(location.search);

function detectInvite(){
  const m = location.pathname.match(/^\/invite\/([^/]+)/);
  state.inviteToken = m ? decodeURIComponent(m[1]) : (params.get('invite') || null);
}
function toast(msg, ok=true){
  toastBox.textContent = msg;
  toastBox.className = 'toast ' + (ok ? 'ok' : 'bad');
  toastBox.hidden = false;
  clearTimeout(toastBox._t);
  toastBox._t = setTimeout(()=>toastBox.hidden=true, 3600);
}
async function api(action, options={}){
  const res = await fetch(`/api?action=${encodeURIComponent(action)}`, {
    method: options.method || (options.body ? 'POST' : 'GET'),
    headers: options.body ? {'Content-Type':'application/json'} : {},
    credentials: 'same-origin',
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const json = await res.json().catch(()=>({ok:false,message:'Réponse invalide'}));
  if(!res.ok || json.ok === false) throw new Error(json.message || 'Erreur API');
  return json;
}
async function boot(){
  detectInvite();
  try{
    const setup = await api('setup-status');
    state.needsSetup = setup.needsSetup;
    if(state.inviteToken){
      const inv = await fetch(`/api?action=invite-info&token=${encodeURIComponent(state.inviteToken)}`, {credentials:'same-origin'}).then(r=>r.json());
      if(inv.ok) state.invite = inv.invite;
    }
    const me = await api('me');
    state.user = me.user;
    if(state.user) await loadData(); else render();
  }catch(e){ renderFatal(e.message); }
}
async function loadData(){
  state.data = await api('overview');
  if(state.data.user) state.user = state.data.user;
  render();
}
function renderFatal(msg){ app.innerHTML = `<section class="card auth"><div class="seal">⚠</div><h1>Configuration requise</h1><p class="muted">${esc(msg)}</p><p class="hint">Ajoute une variable d’environnement <b>DATABASE_URL</b> ou <b>POSTGRES_URL</b> dans Vercel avec ton URL PostgreSQL, puis redéploie.</p></section>`; }
function page(title, subtitle, body){ return `<section class="card auth"><div class="seal">⚖</div><h1>${esc(title)}</h1><p class="subtitle">${esc(subtitle)}</p>${body}</section>`; }
function render(){
  if(state.needsSetup) return renderSetup();
  if(state.inviteToken && !state.user) return renderInvite();
  if(!state.user) return renderLogin();
  renderApp();
}
function renderSetup(){
  app.innerHTML = page('Initialisation', 'Créer le compte gérant principal', `
    <form data-form="setup" class="form-grid one">
      <label>Prénom<input name="firstName" required minlength="2" autocomplete="given-name"></label>
      <label>Nom<input name="lastName" required minlength="2" autocomplete="family-name"></label>
      <label>Mot de passe gérant<input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
      <button class="primary">Créer le tribunal</button>
    </form>
    <p class="hint">Cette étape est sauvegardée en SQL, donc elle ne disparaît plus au redémarrage.</p>`);
}
function renderLogin(){
  app.innerHTML = page('Connexion', 'Tribunal de Sunagakure', `
    <form data-form="login" class="form-grid one">
      <label>Nom ou prénom<input name="login" required autocomplete="username" placeholder="ex: Hanma Senju"></label>
      <label>Mot de passe<input name="password" type="password" required autocomplete="current-password"></label>
      <button class="primary">Entrer</button>
    </form>
    ${state.inviteToken ? `<p class="hint"><a href="/invite/${encodeURIComponent(state.inviteToken)}">Utiliser l’invitation reçue</a></p>`:''}`);
}
function renderInvite(){
  if(!state.invite) return app.innerHTML = page('Invitation invalide', 'Lien expiré ou déjà utilisé', `<p class="hint">Demande au gérant de générer un nouveau lien.</p><button data-action="go-login" class="ghost wide">Retour connexion</button>`);
  const i = state.invite;
  app.innerHTML = page('Invitation', `Grade proposé : ${i.role}`, `
    <form data-form="accept-invite" class="form-grid one">
      <label>Prénom<input name="firstName" value="${esc(i.first_name||'')}" ${i.first_name?'readonly':''} required minlength="2"></label>
      <label>Nom<input name="lastName" value="${esc(i.last_name||'')}" ${i.last_name?'readonly':''} required minlength="2"></label>
      <label>Mot de passe<input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
      <button class="primary">Créer mon accès</button>
    </form>
    <p class="hint">Lien valable jusqu’au ${date(i.expires_at)}.</p>`);
}
function renderApp(){
  const tabs = [ ['dashboard','Accueil'], ['members','Membres'], ['treasury','Trésorerie'], ['judgments','Jugements'], ['tasks','Tâches'] ];
  if(isManager()) tabs.push(['invites','Invitations'], ['audit','Audit']);
  app.className = 'app-shell';
  app.innerHTML = `
    <header class="topbar"><div><b>Justice</b><span>Tribunal de Sunagakure</span></div><div class="user"><span>${esc(state.user.name)}</span><small>${esc(state.user.role)}</small><button data-action="logout" class="ghost">Déconnexion</button></div></header>
    <nav class="tabs">${tabs.map(t=>`<button data-tab="${t[0]}" class="${state.tab===t[0]?'on':''}">${t[1]}</button>`).join('')}</nav>
    <section class="grid-main">${renderTab()}</section>`;
}
function renderTab(){
  if(!state.data) return `<div class="card">Chargement…</div>`;
  return ({dashboard:dashboard, members:members, treasury:treasury, judgments:judgments, tasks:tasks, invites:invites, audit:audit}[state.tab] || dashboard)();
}
function dashboard(){
  const d = state.data;
  return `<div class="card hero"><div><span class="eyebrow">Solde du trésor</span><strong>${fmt(d.balance)}</strong><p>Base SQL active, sessions persistantes, liens d’invitation uniques.</p></div><div class="seal mini">⚖</div></div>
  <div class="cards3">
    <div class="card stat"><span>Membres</span><b>${d.users.length}</b></div>
    <div class="card stat"><span>Jugements</span><b>${d.judgments.length}</b></div>
    <div class="card stat"><span>Tâches</span><b>${d.tasks.length}</b></div>
  </div>
  <div class="card"><h2>Dernières tâches</h2>${list(d.tasks.slice(0,5), x=>`<b>${esc(x.type)}</b><small>${esc(x.details)} · ${esc(x.status)}</small>`)}</div>`;
}
function members(){
  const roleOptions = roles.filter(r=> r !== 'Gérant' && (isGerant() || r !== 'Co-gérant'));
  return `<div class="card"><h2>Membres</h2>${list(state.data.users, u=>`
    <b>${esc(u.name)}</b><span class="pill">${esc(u.role)}</span><small>${esc(u.status)} · créé le ${date(u.createdAt)}</small>
    ${isManager() && u.role!=='Gérant' && u.id!==state.user.id ? `<div class="line-actions"><select data-role-user="${u.id}">${roleOptions.map(r=>`<option ${r===u.role?'selected':''}>${r}</option>`).join('')}</select><button data-action="toggle-user" data-id="${u.id}" data-status="${u.status==='active'?'suspended':'active'}" class="danger">${u.status==='active'?'Suspendre':'Réactiver'}</button></div>`:''}`)}</div>`;
}
function invites(){
  const roleOptions = roles.filter(r=> r !== 'Gérant' && (isGerant() || r !== 'Co-gérant'));
  return `<div class="card"><h2>Générer un lien d’invitation</h2>
    ${state.lastInviteUrl ? `<div class="invite-link"><input value="${esc(state.lastInviteUrl)}" readonly><button type="button" data-copy="${esc(state.lastInviteUrl)}">Copier</button></div>`:''}
    <form data-form="create-invite" class="form-grid">
      <label>Grade<select name="role">${roleOptions.map(r=>`<option>${r}</option>`).join('')}</select></label>
      <label>Prénom facultatif<input name="firstName"></label><label>Nom facultatif<input name="lastName"></label>
      <label>Expire dans<select name="days"><option>1</option><option selected>7</option><option>14</option><option>30</option></select></label>
      <label class="full">Note interne<input name="note" placeholder="Ex: recrutement avocat"></label><button class="primary">Générer le lien</button>
    </form><div id="inviteResult"></div></div>
    <div class="card"><h2>Invitations</h2>${list(state.data.invites, i=>`<b>${esc(i.role)}</b><small>${esc([i.first_name,i.last_name].filter(Boolean).join(' ')||'Nom libre')} · expire ${date(i.expires_at)} · ${i.used_at?'utilisée':i.revoked_at?'révoquée':'active'}</small>${!i.used_at&&!i.revoked_at?`<button data-action="revoke-invite" data-id="${i.id}" class="danger">Révoquer</button>`:''}`)}</div>`;
}
function treasury(){
  return `<div class="card"><h2>Trésorerie</h2><p class="big-money">${fmt(state.data.balance)}</p><form data-form="treasury" class="form-grid"><label>Type<select name="type"><option value="depot">Dépôt</option>${isManager()?'<option value="retrait">Retrait</option>':''}</select></label><label>Montant<input name="amount" type="number" min="1" required></label><label class="full">Motif<input name="note"></label><button class="primary">Enregistrer</button></form></div>
  <div class="card"><h2>Historique</h2>${list(state.data.treasury, x=>`<b class="${x.type==='depot'?'pos':'neg'}">${x.type==='depot'?'+':'−'}${fmt(x.amount)}</b><small>${esc(x.note||'Sans motif')} · ${esc(x.author)} · ${date(x.created_at)}${x.commission?` · paye ${fmt(x.commission)}`:''}</small>`)}</div>`;
}
function judgments(){
  return `${canJudge()?`<div class="card"><h2>Nouveau jugement</h2><form data-form="judgment" class="form-grid"><label>Affaire<input name="title" required></label><label>Date<input name="day" type="date"></label><label>Accusé<input name="accused" required></label><label>Juge<input name="judge" value="${esc(state.user.name)}"></label><label>Avocat<input name="lawyer"></label><label>Procureur<input name="prosecutor"></label><label>Verdict<select name="verdict"><option>En cours</option><option>Coupable</option><option>Non coupable</option><option>Relaxé</option><option>Renvoyé</option></select></label><label>Charges<input name="charges"></label><label class="full">Notes<textarea name="notes" rows="3"></textarea></label><button class="primary">Créer</button></form></div>`:''}
  <div class="card"><h2>Jugements</h2>${list(state.data.judgments, j=>`<b>${esc(j.title)}</b><span class="pill">${esc(j.verdict)}</span><small>${date(j.day)} · accusé ${esc(j.accused)} · juge ${esc(j.judge||'—')}</small>${j.notes?`<small>${esc(j.notes)}</small>`:''}`)}</div>`;
}
function tasks(){
  return `<div class="card"><h2>Nouvelle tâche</h2><form data-form="task" class="form-grid"><label>Type<select name="type"><option>Jugement</option><option>Défense d'un client</option><option>Procuration</option><option>Demande d'adoption</option><option>Changement de nom</option><option>Administration</option></select></label>${isManager()?`<label>Assignée à<select name="assignedTo"><option value="">Moi</option>${state.data.users.filter(u=>u.status==='active').map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></label>`:''}<label class="full">Détails<input name="details" required></label><button class="primary">Ajouter</button></form></div>
  <div class="card"><h2>Tâches</h2>${list(state.data.tasks, t=>`<b>${esc(t.type)}</b><span class="pill">${esc(t.status)}</span><small>${esc(t.details)} · assigné à ${esc(t.assigned_name)} · ${date(t.created_at)}</small><div class="line-actions"><button data-action="task-status" data-id="${t.id}" data-status="En cours" class="ghost">En cours</button><button data-action="task-status" data-id="${t.id}" data-status="Terminé" class="ghost">Terminé</button></div>`)}</div>`;
}
function audit(){
  return `<div class="card"><h2>Audit</h2><button data-action="export" class="ghost">Exporter JSON</button>${list(state.data.audit, a=>`<b>${esc(a.action)}</b><small>${esc(a.actor)} · ${esc(a.entity)} · ${date(a.created_at)}</small>`)}</div>`;
}
function list(items, render){ return items?.length ? `<div class="list">${items.map(x=>`<article class="row-item">${render(x)}</article>`).join('')}</div>` : `<p class="empty">Aucune donnée.</p>`; }

function data(form){ return Object.fromEntries(new FormData(form).entries()); }
app.addEventListener('submit', async e=>{
  const form = e.target.closest('form[data-form]'); if(!form) return; e.preventDefault();
  const name = form.dataset.form; const d = data(form);
  try{
    if(name==='setup'){ await api('setup', { body:d }); state.needsSetup=false; toast('Tribunal initialisé. Connecte-toi.'); renderLogin(); return; }
    if(name==='login'){ const r = await api('login', { body:d }); state.user=r.user; await loadData(); toast('Connecté.'); return; }
    if(name==='accept-invite'){ await api('accept-invite', { body:{...d, token:state.inviteToken} }); history.replaceState(null,'','/'); state.inviteToken=null; toast('Compte créé. Connecte-toi.'); renderLogin(); return; }
    if(name==='create-invite'){ const r = await api('create-invite', { body:d }); state.lastInviteUrl = r.invite.url; await loadData(); toast('Lien généré.'); return; }
    const map = { treasury:'create-treasury', judgment:'create-judgment', task:'create-task' };
    if(map[name]){ await api(map[name], { body:d }); form.reset(); await loadData(); toast('Enregistré.'); }
  }catch(err){ toast(err.message, false); }
});
app.addEventListener('click', async e=>{
  const tab = e.target.closest('[data-tab]'); if(tab){ state.tab = tab.dataset.tab; renderApp(); return; }
  const copy = e.target.closest('[data-copy]'); if(copy){ await navigator.clipboard.writeText(copy.dataset.copy); toast('Lien copié.'); return; }
  const b = e.target.closest('[data-action]'); if(!b) return;
  try{
    if(b.dataset.action==='logout'){ await api('logout', { body:{} }); state.user=null; state.data=null; renderLogin(); return; }
    if(b.dataset.action==='go-login'){ history.replaceState(null,'','/'); state.inviteToken=null; renderLogin(); return; }
    if(b.dataset.action==='revoke-invite'){ await api('revoke-invite', { body:{id:b.dataset.id} }); await loadData(); return; }
    if(b.dataset.action==='toggle-user'){ await api('set-user-status', { body:{id:b.dataset.id,status:b.dataset.status} }); await loadData(); return; }
    if(b.dataset.action==='task-status'){ await api('task-status', { body:{id:b.dataset.id,status:b.dataset.status} }); await loadData(); return; }
    if(b.dataset.action==='export'){ const r = await api('export', { body:{} }); const blob = new Blob([JSON.stringify(r.data,null,2)], {type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='tribunal-suna-export.json'; a.click(); URL.revokeObjectURL(a.href); }
  }catch(err){ toast(err.message, false); }
});
app.addEventListener('change', async e=>{
  const sel = e.target.closest('[data-role-user]'); if(!sel) return;
  try{ await api('update-role', { body:{id:sel.dataset.roleUser, role:sel.value} }); await loadData(); toast('Grade modifié.'); }catch(err){ toast(err.message,false); }
});
boot();
