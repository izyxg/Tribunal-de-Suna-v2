const { Pool } = require('pg');
const crypto = require('crypto');

let pool;
function conn(){return process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL_NON_POOLING || ''}
function db(){
  const c=conn();
  if(!c) throw Object.assign(new Error('DATABASE_URL manquant'),{status:503});
  if(!pool){
    const ssl=/sslmode=disable/i.test(c)||process.env.PGSSLMODE==='disable'?false:{rejectUnauthorized:false};
    pool=new Pool({connectionString:c,ssl,max:5,idleTimeoutMillis:20000,connectionTimeoutMillis:10000});
  }
  return pool;
}
const sha=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
const cid=()=>crypto.randomUUID?crypto.randomUUID():crypto.randomBytes(16).toString('hex');
function parse(req){return Object.fromEntries(new URL(req.url,'http://localhost').searchParams.entries())}
function cookies(req){return Object.fromEntries(String(req.headers.cookie||'').split(';').map(x=>x.trim()).filter(Boolean).map(x=>{const i=x.indexOf('=');return [decodeURIComponent(x.slice(0,i)),decodeURIComponent(x.slice(i+1))]}))}
function send(res,code,data){res.statusCode=code;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data))}
function fail(res,e){const code=e.status||500;send(res,code,{ok:false,message:code===500?'Erreur serveur modération.':e.message})}
function deny(ok,msg='Accès refusé'){if(!ok)throw Object.assign(new Error(msg),{status:403})}
function read(req){return new Promise((resolve,reject)=>{let raw='';req.on('data',c=>{raw+=c;if(raw.length>300000)reject(Object.assign(new Error('Payload trop large'),{status:413}))});req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{})}catch{reject(Object.assign(new Error('JSON invalide'),{status:400}))}});req.on('error',reject)})}
async function current(req){
  const token=cookies(req).ts_session||String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  if(!token) return null;
  const r=await db().query(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW() AND u.status='active'`,[sha(token)]);
  return r.rows[0]||null;
}
const isMan=u=>u&&['Gérant','Co-gérant'].includes(u.role);
const isJudge=u=>u&&u.role==='Magistrat';
async function audit(u,action,entity,entityId,meta={}){
  try{await db().query(`INSERT INTO audit_events(id,actor_id,action,entity,entity_id,meta) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,[cid(),u&&u.id,action,entity,entityId||null,JSON.stringify(meta)])}catch{}
}
async function deleteTask(req,res,u){
  const b=await read(req),id=String(b.id||'');
  const t=(await db().query(`SELECT * FROM tasks WHERE id=$1`,[id])).rows[0];
  if(!t) throw Object.assign(new Error('Tâche introuvable.'),{status:404});
  deny(isMan(u)||t.assigned_to===u.id||t.created_by===u.id);
  await db().query(`DELETE FROM tasks WHERE id=$1`,[id]);
  await audit(u,'delete_task','tasks',id,{type:t.type,details:t.details});
  send(res,200,{ok:true});
}
async function deleteJudgment(req,res,u){
  const b=await read(req),id=String(b.id||'');
  const j=(await db().query(`SELECT * FROM judgments WHERE id=$1`,[id])).rows[0];
  if(!j) throw Object.assign(new Error('Jugement introuvable.'),{status:404});
  deny(isMan(u)||isJudge(u)||j.created_by===u.id);
  await db().query(`DELETE FROM judgments WHERE id=$1`,[id]);
  await audit(u,'delete_judgment','judgments',id,{title:j.title,accused:j.accused});
  send(res,200,{ok:true});
}
async function deleteTreasury(req,res,u){
  deny(isMan(u));
  const b=await read(req),id=String(b.id||'');
  const t=(await db().query(`SELECT * FROM treasury WHERE id=$1`,[id])).rows[0];
  if(!t) throw Object.assign(new Error('Opération introuvable.'),{status:404});
  await db().query(`DELETE FROM treasury WHERE id=$1`,[id]);
  await audit(u,'delete_treasury','treasury',id,{type:t.type,amount:t.amount,note:t.note});
  send(res,200,{ok:true});
}
async function purgeInvites(req,res,u){
  deny(isMan(u));
  const r=await db().query(`DELETE FROM invites WHERE used_at IS NOT NULL OR revoked_at IS NOT NULL OR expires_at<NOW()`);
  await audit(u,'purge_invites','invites',null,{deleted:r.rowCount});
  send(res,200,{ok:true,deleted:r.rowCount});
}
module.exports=async(req,res)=>{
  try{
    res.setHeader('Cache-Control','no-store');
    if(req.method==='OPTIONS')return send(res,200,{ok:true});
    if(req.method!=='POST')throw Object.assign(new Error('Méthode refusée'),{status:405});
    const u=await current(req); if(!u) throw Object.assign(new Error('Connexion requise.'),{status:401});
    const a=String(parse(req).action||'');
    const routes={deleteTask,deleteJudgment,deleteTreasury,purgeInvites};
    const key=a.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
    if(routes[key]) return routes[key](req,res,u);
    throw Object.assign(new Error('Action modération inconnue.'),{status:404});
  }catch(e){fail(res,e)}
};
