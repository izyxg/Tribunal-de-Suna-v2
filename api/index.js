const { Pool } = require('pg');
const crypto = require('crypto');

const ROLES = ['Gérant','Co-gérant','Magistrat','Greffier','Procureur','Avocat','Auditeur'];
const POWER = { 'Gérant': 100, 'Co-gérant': 80, 'Magistrat': 60, 'Greffier': 50, 'Procureur': 50, 'Avocat': 40, 'Auditeur': 10 };
const SESSION_DAYS = 14;
const ITERATIONS = 210000;
let pool;
let initialized;

function connectionString(){
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL_NON_POOLING || '';
}
function db(){
  const conn = connectionString();
  if(!conn) throw Object.assign(new Error('DATABASE_URL manquant'), { status: 503, code: 'missing_database_url' });
  if(!pool){
    const ssl = /sslmode=disable/i.test(conn) || process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized:false };
    pool = new Pool({ connectionString: conn, ssl, max: 6, idleTimeoutMillis: 20000, connectionTimeoutMillis: 10000 });
  }
  return pool;
}
async function init(){
  if(initialized) return;
  const q = db().query.bind(db());
  await q(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    role TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_iterations INTEGER NOT NULL DEFAULT ${ITERATIONS},
    status TEXT NOT NULL DEFAULT 'active',
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
  )`);
  await q(`CREATE TABLE IF NOT EXISTS invites (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    note TEXT,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    used_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
  )`);
  await q(`CREATE TABLE IF NOT EXISTS treasury (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    commission INTEGER NOT NULL DEFAULT 0,
    net INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS judgments (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    day DATE,
    accused TEXT NOT NULL,
    lawyer TEXT,
    judge TEXT,
    prosecutor TEXT,
    verdict TEXT NOT NULL DEFAULT 'En cours',
    charges TEXT,
    notes TEXT,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    details TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'À faire',
    assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT,
    meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_invites_token ON invites(token_hash)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at DESC)`);
  initialized = true;
}

const id = () => crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
const rawToken = () => crypto.randomBytes(32).toString('base64url');
const hash = v => crypto.createHash('sha256').update(String(v)).digest('hex');
const norm = v => String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
function passwordHash(password, salt = crypto.randomBytes(16).toString('hex'), iterations = ITERATIONS){
  const digest = crypto.pbkdf2Sync(String(password), salt, iterations, 32, 'sha256').toString('hex');
  return { salt, iterations, digest };
}
function verifyPassword(password, user){
  const out = passwordHash(password, user.password_salt, user.password_iterations || ITERATIONS).digest;
  return crypto.timingSafeEqual(Buffer.from(out, 'hex'), Buffer.from(user.password_hash, 'hex'));
}
function body(req){
  return new Promise((resolve,reject)=>{
    if(req.body && typeof req.body === 'object') return resolve(req.body);
    let raw='';
    req.on('data', c => { raw += c; if(raw.length > 1000000) reject(Object.assign(new Error('Payload trop large'), { status:413 })); });
    req.on('end', () => { if(!raw) return resolve({}); try{ resolve(JSON.parse(raw)); }catch{ reject(Object.assign(new Error('JSON invalide'), { status:400 })); } });
    req.on('error', reject);
  });
}
function send(res, code, data){ res.statusCode = code; res.setHeader('Content-Type','application/json; charset=utf-8'); res.end(JSON.stringify(data)); }
function fail(res, err){ const code = err.status || 500; send(res, code, { ok:false, error: err.code || 'server_error', message: code === 500 ? 'Erreur serveur.' : err.message }); }
function method(req, allowed){ if(!allowed.includes(req.method)) throw Object.assign(new Error('Méthode refusée'), { status:405, code:'method_not_allowed' }); }
function cookies(req){
  return Object.fromEntries(String(req.headers.cookie||'').split(';').map(x=>x.trim()).filter(Boolean).map(x=>{ const i=x.indexOf('='); return [decodeURIComponent(x.slice(0,i)), decodeURIComponent(x.slice(i+1))]; }));
}
function setSessionCookie(req,res,token){
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0] || 'http';
  const secure = proto === 'https' || String(req.headers.host||'').includes('.vercel.app');
  res.setHeader('Set-Cookie', `ts_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS*86400}${secure?'; Secure':''}`);
}
function clearSessionCookie(res){ res.setHeader('Set-Cookie', 'ts_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'); }
function publicUser(u){ return u && { id:u.id, firstName:u.first_name, lastName:u.last_name, name:`${u.first_name} ${u.last_name}`.trim(), role:u.role, status:u.status, createdAt:u.created_at }; }
function manager(u){ return u && POWER[u.role] >= POWER['Co-gérant']; }
function gerant(u){ return u && u.role === 'Gérant'; }
function canJudge(u){ return u && u.role !== 'Auditeur'; }
function assertRole(u, ok, msg='Accès refusé'){ if(!ok) throw Object.assign(new Error(msg), { status:403, code:'forbidden' }); }
async function currentUser(req){
  const token = cookies(req).ts_session || String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  if(!token) return null;
  const r = await db().query(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW() AND u.status='active'`, [hash(token)]);
  return r.rows[0] || null;
}
async function audit(actor, action, entity, entityId, meta={}){
  await db().query(`INSERT INTO audit_events(id,actor_id,action,entity,entity_id,meta) VALUES($1,$2,$3,$4,$5,$6::jsonb)`, [id(), actor && actor.id, action, entity, entityId || null, JSON.stringify(meta)]);
}
async function userCount(){ const r = await db().query('SELECT COUNT(*)::int AS n FROM users'); return r.rows[0].n; }
function inviteUrl(req, token){
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0] || 'https';
  return `${proto}://${req.headers.host}/invite/${encodeURIComponent(token)}`;
}

async function setupStatus(req,res){
  method(req, ['GET']); await init(); send(res, 200, { ok:true, needsSetup:(await userCount()) === 0 });
}
async function setup(req,res){
  method(req, ['POST']); await init();
  if(await userCount()) throw Object.assign(new Error('Le gérant existe déjà.'), { status:409, code:'already_setup' });
  const b = await body(req);
  const first = String(b.firstName||'').trim(); const last = String(b.lastName||'').trim(); const pass = String(b.password||'');
  if(first.length < 2 || last.length < 2 || pass.length < 8) throw Object.assign(new Error('Prénom/nom requis et mot de passe de 8 caractères minimum.'), { status:400, code:'invalid_setup' });
  const h = passwordHash(pass); const uid = id();
  await db().query(`INSERT INTO users(id,first_name,last_name,role,password_hash,password_salt,password_iterations,status) VALUES($1,$2,$3,'Gérant',$4,$5,$6,'active')`, [uid, first, last, h.digest, h.salt, h.iterations]);
  await audit({id:uid}, 'setup', 'users', uid, { role:'Gérant' });
  send(res, 201, { ok:true });
}
async function login(req,res){
  method(req, ['POST']); await init();
  const b = await body(req); const login = norm(b.login); const pass = String(b.password||'');
  const r = await db().query(`SELECT * FROM users WHERE status='active'`);
  const user = r.rows.find(u => norm(`${u.first_name} ${u.last_name}`) === login || norm(u.first_name) === login || norm(u.last_name) === login);
  if(!user || !verifyPassword(pass, user)) throw Object.assign(new Error('Identifiants incorrects.'), { status:401, code:'bad_credentials' });
  const token = rawToken(); const sid = id();
  await db().query(`INSERT INTO sessions(id,user_id,token_hash,user_agent,expires_at) VALUES($1,$2,$3,$4,NOW()+($5||' days')::interval)`, [sid, user.id, hash(token), String(req.headers['user-agent']||'').slice(0,240), SESSION_DAYS]);
  await audit(user, 'login', 'sessions', sid);
  setSessionCookie(req,res,token); send(res, 200, { ok:true, user:publicUser(user) });
}
async function logout(req,res){
  method(req, ['POST']); await init();
  const token = cookies(req).ts_session; if(token) await db().query(`DELETE FROM sessions WHERE token_hash=$1`, [hash(token)]);
  clearSessionCookie(res); send(res, 200, { ok:true });
}
async function me(req,res){ method(req, ['GET']); await init(); send(res, 200, { ok:true, user: publicUser(await currentUser(req)) }); }

async function inviteInfo(req,res){
  method(req, ['GET']); await init();
  const token = String(req.query.token||'');
  const r = await db().query(`SELECT id,role,first_name,last_name,note,expires_at FROM invites WHERE token_hash=$1 AND used_at IS NULL AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>NOW())`, [hash(token)]);
  if(!r.rows[0]) throw Object.assign(new Error('Invitation invalide ou expirée.'), { status:404, code:'invite_invalid' });
  send(res, 200, { ok:true, invite:r.rows[0] });
}
async function acceptInvite(req,res){
  method(req, ['POST']); await init();
  const b = await body(req); const token = String(b.token||'');
  const first = String(b.firstName||'').trim(); const last = String(b.lastName||'').trim(); const pass = String(b.password||'');
  const r = await db().query(`SELECT * FROM invites WHERE token_hash=$1 AND used_at IS NULL AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>NOW())`, [hash(token)]);
  const inv = r.rows[0];
  if(!inv) throw Object.assign(new Error('Invitation invalide ou expirée.'), { status:404, code:'invite_invalid' });
  const finalFirst = inv.first_name || first; const finalLast = inv.last_name || last;
  if(finalFirst.length < 2 || finalLast.length < 2 || pass.length < 8) throw Object.assign(new Error('Prénom/nom requis et mot de passe de 8 caractères minimum.'), { status:400, code:'invalid_invite' });
  const same = await db().query(`SELECT id FROM users WHERE LOWER(first_name)=LOWER($1) AND LOWER(last_name)=LOWER($2)`, [finalFirst, finalLast]);
  if(same.rows[0]) throw Object.assign(new Error('Un compte existe déjà avec ce nom.'), { status:409, code:'user_exists' });
  const h = passwordHash(pass); const uid = id();
  const client = await db().connect();
  try{
    await client.query('BEGIN');
    await client.query(`INSERT INTO users(id,first_name,last_name,role,password_hash,password_salt,password_iterations,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,'active',$8)`, [uid, finalFirst, finalLast, inv.role, h.digest, h.salt, h.iterations, inv.created_by]);
    await client.query(`UPDATE invites SET used_by=$1, used_at=NOW() WHERE id=$2`, [uid, inv.id]);
    await client.query(`INSERT INTO audit_events(id,actor_id,action,entity,entity_id,meta) VALUES($1,$2,$3,$4,$5,$6::jsonb)`, [id(), uid, 'accept_invite', 'invites', inv.id, JSON.stringify({ role: inv.role })]);
    await client.query('COMMIT');
  }catch(e){ await client.query('ROLLBACK'); throw e; }
  finally{ client.release(); }
  send(res, 201, { ok:true });
}
async function createInvite(req,res,user){
  assertRole(user, manager(user));
  const b = await body(req); const role = String(b.role||'Auditeur');
  if(!ROLES.includes(role) || role === 'Gérant' || (!gerant(user) && role === 'Co-gérant')) throw Object.assign(new Error('Grade non autorisé.'), { status:400, code:'bad_role' });
  const days = Math.max(1, Math.min(30, Number(b.days || 7))); const token = rawToken(); const invId = id();
  await db().query(`INSERT INTO invites(id,token_hash,role,first_name,last_name,note,created_by,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,NOW()+($8||' days')::interval)`, [invId, hash(token), role, String(b.firstName||'').trim()||null, String(b.lastName||'').trim()||null, String(b.note||'').trim()||null, user.id, days]);
  await audit(user, 'create_invite', 'invites', invId, { role, days });
  send(res, 201, { ok:true, invite:{ id:invId, role, url:inviteUrl(req, token), expiresInDays:days } });
}
async function revokeInvite(req,res,user){
  assertRole(user, manager(user)); const b = await body(req);
  await db().query(`UPDATE invites SET revoked_at=NOW() WHERE id=$1 AND used_at IS NULL`, [String(b.id||'')]);
  await audit(user, 'revoke_invite', 'invites', b.id); send(res, 200, { ok:true });
}
async function overview(req,res,user){
  const client = db();
  const users = (await client.query(`SELECT id,first_name,last_name,role,status,created_at FROM users ORDER BY CASE role WHEN 'Gérant' THEN 1 WHEN 'Co-gérant' THEN 2 WHEN 'Magistrat' THEN 3 WHEN 'Greffier' THEN 4 WHEN 'Procureur' THEN 5 WHEN 'Avocat' THEN 6 ELSE 7 END, first_name`)).rows.map(publicUser);
  const treasury = (await client.query(`SELECT t.*, COALESCE(u.first_name||' '||u.last_name,'Système') AS author FROM treasury t LEFT JOIN users u ON u.id=t.created_by ORDER BY t.created_at DESC LIMIT 80`)).rows;
  const balance = treasury.reduce((s,x)=>s + (x.type === 'depot' ? Number(x.net || x.amount) : -Number(x.amount)),0);
  const judgments = (await client.query(`SELECT j.*, COALESCE(u.first_name||' '||u.last_name,'Système') AS author FROM judgments j LEFT JOIN users u ON u.id=j.created_by ORDER BY COALESCE(j.day, j.created_at::date) DESC, j.created_at DESC LIMIT 80`)).rows;
  const tasks = (await client.query(`SELECT t.*, COALESCE(a.first_name||' '||a.last_name,'Non assigné') AS assigned_name, COALESCE(c.first_name||' '||c.last_name,'Système') AS author FROM tasks t LEFT JOIN users a ON a.id=t.assigned_to LEFT JOIN users c ON c.id=t.created_by ORDER BY t.created_at DESC LIMIT 120`)).rows;
  let invites = [], auditRows = [];
  if(manager(user)){
    invites = (await client.query(`SELECT i.id,i.role,i.first_name,i.last_name,i.note,i.created_at,i.expires_at,i.used_at,i.revoked_at,COALESCE(u.first_name||' '||u.last_name,'Système') AS author FROM invites i LEFT JOIN users u ON u.id=i.created_by ORDER BY i.created_at DESC LIMIT 80`)).rows;
    auditRows = (await client.query(`SELECT a.*, COALESCE(u.first_name||' '||u.last_name,'Système') AS actor FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 60`)).rows;
  }
  send(res, 200, { ok:true, user:publicUser(user), roles:ROLES, balance, users, treasury, judgments, tasks, invites, audit:auditRows });
}
async function updateRole(req,res,user){
  assertRole(user, manager(user)); const b = await body(req); const role = String(b.role||'');
  if(!ROLES.includes(role) || role === 'Gérant' || (!gerant(user) && role === 'Co-gérant')) throw Object.assign(new Error('Grade non autorisé.'), { status:400, code:'bad_role' });
  const target = String(b.id||''); if(target === user.id) throw Object.assign(new Error('Impossible de modifier ton propre grade.'), { status:400, code:'self_role' });
  const r = await db().query(`SELECT role FROM users WHERE id=$1`, [target]); if(!r.rows[0]) throw Object.assign(new Error('Membre introuvable.'), { status:404 });
  if(r.rows[0].role === 'Gérant') throw Object.assign(new Error('Le gérant ne peut pas être modifié.'), { status:403 });
  await db().query(`UPDATE users SET role=$1, updated_at=NOW() WHERE id=$2`, [role, target]); await audit(user, 'update_role', 'users', target, { role }); send(res, 200, { ok:true });
}
async function setUserStatus(req,res,user){
  assertRole(user, manager(user)); const b = await body(req); const target = String(b.id||''); const status = b.status === 'suspended' ? 'suspended':'active';
  if(target === user.id) throw Object.assign(new Error('Impossible de te suspendre toi-même.'), { status:400 });
  const r = await db().query(`SELECT role FROM users WHERE id=$1`, [target]); if(!r.rows[0]) throw Object.assign(new Error('Membre introuvable.'), { status:404 });
  if(r.rows[0].role === 'Gérant') throw Object.assign(new Error('Le gérant ne peut pas être suspendu.'), { status:403 });
  await db().query(`UPDATE users SET status=$1, updated_at=NOW() WHERE id=$2`, [status, target]); await audit(user, 'set_user_status', 'users', target, { status }); send(res, 200, { ok:true });
}
async function createTreasury(req,res,user){
  const b = await body(req); const type = b.type === 'retrait' ? 'retrait':'depot'; const amount = Math.floor(Math.abs(Number(b.amount||0)));
  if(!amount) throw Object.assign(new Error('Montant invalide.'), { status:400 }); if(type === 'retrait') assertRole(user, manager(user), 'Seuls les gérants peuvent retirer.');
  const commission = type === 'depot' ? Math.floor(amount * 0.10) : 0; const net = type === 'depot' ? amount - commission : amount;
  const opId = id(); await db().query(`INSERT INTO treasury(id,type,amount,commission,net,note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)`, [opId,type,amount,commission,net,String(b.note||'').trim()||null,user.id]);
  await audit(user, 'create_treasury', 'treasury', opId, { type, amount }); send(res, 201, { ok:true });
}
async function createJudgment(req,res,user){
  assertRole(user, canJudge(user)); const b = await body(req); const jid = id();
  if(!String(b.title||'').trim() || !String(b.accused||'').trim()) throw Object.assign(new Error('Affaire et accusé requis.'), { status:400 });
  await db().query(`INSERT INTO judgments(id,title,day,accused,lawyer,judge,prosecutor,verdict,charges,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [jid,String(b.title).trim(),b.day||null,String(b.accused).trim(),String(b.lawyer||'').trim(),String(b.judge||'').trim()||`${user.first_name} ${user.last_name}`,String(b.prosecutor||'').trim(),String(b.verdict||'En cours'),String(b.charges||'').trim(),String(b.notes||'').trim(),user.id]);
  await audit(user, 'create_judgment', 'judgments', jid); send(res, 201, { ok:true });
}
async function createTask(req,res,user){
  const b = await body(req); const tid = id(); if(!String(b.details||'').trim()) throw Object.assign(new Error('Détails requis.'), { status:400 });
  const assigned = manager(user) && b.assignedTo ? String(b.assignedTo) : user.id;
  await db().query(`INSERT INTO tasks(id,type,details,assigned_to,created_by) VALUES($1,$2,$3,$4,$5)`, [tid,String(b.type||'Tâche'),String(b.details).trim(),assigned,user.id]);
  await audit(user, 'create_task', 'tasks', tid); send(res, 201, { ok:true });
}
async function taskStatus(req,res,user){
  const b = await body(req); const status = ['À faire','En cours','Terminé'].includes(b.status) ? b.status : 'À faire';
  const t = await db().query(`SELECT * FROM tasks WHERE id=$1`, [String(b.id||'')]); if(!t.rows[0]) throw Object.assign(new Error('Tâche introuvable.'), { status:404 });
  assertRole(user, manager(user) || t.rows[0].assigned_to === user.id || t.rows[0].created_by === user.id);
  await db().query(`UPDATE tasks SET status=$1, updated_at=NOW() WHERE id=$2`, [status,b.id]); await audit(user, 'update_task_status', 'tasks', b.id, { status }); send(res, 200, { ok:true });
}
async function exportAll(req,res,user){
  assertRole(user, gerant(user));
  const tables = ['users','invites','treasury','judgments','tasks','audit_events']; const out = {};
  for(const t of tables) out[t] = (await db().query(`SELECT * FROM ${t} ORDER BY 1`)).rows;
  await audit(user, 'export', 'database', null); send(res, 200, { ok:true, exportedAt:new Date().toISOString(), data:out });
}

module.exports = async (req, res) => {
  try{
    res.setHeader('Cache-Control','no-store');
    const action = String(req.query.action || '');
    if(action === 'setup-status') return await setupStatus(req,res);
    if(action === 'setup') return await setup(req,res);
    if(action === 'login') return await login(req,res);
    if(action === 'logout') return await logout(req,res);
    if(action === 'me') return await me(req,res);
    if(action === 'invite-info') return await inviteInfo(req,res);
    if(action === 'accept-invite') return await acceptInvite(req,res);
    await init(); const user = await currentUser(req);
    if(!user) throw Object.assign(new Error('Connexion requise.'), { status:401, code:'unauthorized' });
    if(action === 'overview') return await overview(req,res,user);
    if(action === 'create-invite') return await createInvite(req,res,user);
    if(action === 'revoke-invite') return await revokeInvite(req,res,user);
    if(action === 'update-role') return await updateRole(req,res,user);
    if(action === 'set-user-status') return await setUserStatus(req,res,user);
    if(action === 'create-treasury') return await createTreasury(req,res,user);
    if(action === 'create-judgment') return await createJudgment(req,res,user);
    if(action === 'create-task') return await createTask(req,res,user);
    if(action === 'task-status') return await taskStatus(req,res,user);
    if(action === 'export') return await exportAll(req,res,user);
    throw Object.assign(new Error('Action inconnue.'), { status:404, code:'not_found' });
  }catch(err){ fail(res, err); }
};
