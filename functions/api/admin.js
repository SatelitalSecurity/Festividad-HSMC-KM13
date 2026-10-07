const COOKIE="hsmc_admin";
const MAX_AGE=60*60*8;
const PHOTO_PREFIX="meta:";
const NOTICE_PREFIX="notice:";
const IMG_PREFIX="img:";

function json(data,status=200,headers={}){
  return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...headers}});
}
function clean(v,max=300){return String(v??"").trim().slice(0,max)}
function b64url(bytes){
  let s=""; for(const b of bytes)s+=String.fromCharCode(b);
  return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
async function hmac(message,secret){
  const enc=new TextEncoder();
  const key=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC",key,enc.encode(message))));
}
async function makeToken(secret){
  const exp=Math.floor(Date.now()/1000)+MAX_AGE;
  return exp+"."+await hmac(String(exp),secret);
}
function cookieValue(request,name){
  const raw=request.headers.get("Cookie")||"";
  for(const part of raw.split(";")){
    const i=part.indexOf("=");
    if(i>0&&part.slice(0,i).trim()===name)return decodeURIComponent(part.slice(i+1).trim());
  }
  return "";
}
async function isAuth(request,env){
  if(!env.HSMC_ADMIN_PASSWORD)return false;
  const token=cookieValue(request,COOKIE); const [exp,sig]=token.split(".");
  if(!exp||!sig||Number(exp)<Math.floor(Date.now()/1000))return false;
  return sig===await hmac(exp,env.HSMC_ADMIN_PASSWORD);
}
async function sameSecret(a,b){
  const enc=new TextEncoder();
  const [ha,hb]=await Promise.all([
    crypto.subtle.digest("SHA-256",enc.encode(String(a||""))),
    crypto.subtle.digest("SHA-256",enc.encode(String(b||"")))
  ]);
  const A=new Uint8Array(ha),B=new Uint8Array(hb); let diff=0;
  for(let i=0;i<A.length;i++)diff|=A[i]^B[i];
  return diff===0;
}
function configured(env){return !!(env.HSMC_GALLERY&&env.HSMC_ADMIN_PASSWORD)}

async function listPrefix(env,prefix){
  const out=[]; let cursor;
  do{
    const page=await env.HSMC_GALLERY.list({prefix,cursor});
    const vals=await Promise.all(page.keys.map(k=>env.HSMC_GALLERY.get(k.name,"json")));
    for(const v of vals)if(v)out.push(v);
    cursor=page.list_complete?undefined:page.cursor;
  }while(cursor);
  return out.sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
}
async function storeImage(env,id,image){
  if(!(image instanceof File)||!image.size)return null;
  if(!image.type.startsWith("image/"))throw new Error("Selecciona una imagen válida.");
  if(image.size>8*1024*1024)throw new Error("La imagen procesada supera 8 MB.");
  await env.HSMC_GALLERY.put(IMG_PREFIX+id,await image.arrayBuffer(),{metadata:{contentType:image.type||"image/webp"}});
  return "/api/media/"+id;
}

export async function onRequest(context){
  const {request,env}=context;
  if(!configured(env))return json({error:"Falta vincular HSMC_GALLERY en Cloudflare."},503);
  const url=new URL(request.url),action=url.searchParams.get("action")||"session";

  if(action==="login"&&request.method==="POST"){
    const body=await request.json().catch(()=>({}));
    if(!await sameSecret(body.password,env.HSMC_ADMIN_PASSWORD))return json({error:"Contraseña incorrecta."},401);
    const token=await makeToken(env.HSMC_ADMIN_PASSWORD);
    return json({ok:true},200,{"Set-Cookie":COOKIE+"="+encodeURIComponent(token)+"; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age="+MAX_AGE});
  }
  if(action==="logout"&&request.method==="POST"){
    return json({ok:true},200,{"Set-Cookie":COOKIE+"=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0"});
  }
  if(!await isAuth(request,env))return json({error:"Sesión no autorizada."},401);
  if(action==="session")return json({ok:true});

  if(action==="list"&&request.method==="GET"){
    return json({photos:await listPrefix(env,PHOTO_PREFIX)});
  }
  if(action==="upload"&&request.method==="POST"){
    const form=await request.formData();
    const image=form.get("image");
    const id=crypto.randomUUID();
    let imageUrl;
    try{imageUrl=await storeImage(env,id,image)}catch(e){return json({error:e.message},400)}
    if(!imageUrl)return json({error:"Selecciona una fotografía."},400);
    const item={
      id,url:imageUrl,
      title:clean(form.get("title"),90)||"Festividad HSMC",
      date:clean(form.get("date"),10),
      category:clean(form.get("category"),60)||"Festividad 2026",
      description:clean(form.get("description"),300),
      published:String(form.get("published"))==="true",
      createdAt:new Date().toISOString()
    };
    await env.HSMC_GALLERY.put(PHOTO_PREFIX+id,JSON.stringify(item));
    return json({ok:true,photo:item},201);
  }
  if(action==="update"&&request.method==="POST"){
    const body=await request.json().catch(()=>({})); const id=clean(body.id,80);
    const current=await env.HSMC_GALLERY.get(PHOTO_PREFIX+id,"json");
    if(!current)return json({error:"Fotografía no encontrada."},404);
    const item={...current,
      title:clean(body.title,90)||current.title,
      date:clean(body.date,10),
      category:clean(body.category,60)||"Festividad 2026",
      description:clean(body.description,300),
      published:!!body.published,
      updatedAt:new Date().toISOString()
    };
    await env.HSMC_GALLERY.put(PHOTO_PREFIX+id,JSON.stringify(item));
    return json({ok:true,photo:item});
  }
  if(action==="delete"&&request.method==="POST"){
    const body=await request.json().catch(()=>({})); const id=clean(body.id,80);
    const current=await env.HSMC_GALLERY.get(PHOTO_PREFIX+id,"json");
    if(!current)return json({error:"Fotografía no encontrada."},404);
    await Promise.all([env.HSMC_GALLERY.delete(PHOTO_PREFIX+id),env.HSMC_GALLERY.delete(IMG_PREFIX+id)]);
    return json({ok:true});
  }

  if(action==="notices-list"&&request.method==="GET"){
    return json({notices:await listPrefix(env,NOTICE_PREFIX)});
  }
  if(action==="notice-create"&&request.method==="POST"){
    const form=await request.formData();
    const id=crypto.randomUUID();
    let imageUrl=null;
    const image=form.get("image");
    try{if(image instanceof File&&image.size)imageUrl=await storeImage(env,id,image)}catch(e){return json({error:e.message},400)}
    const item={
      id,url:imageUrl,
      title:clean(form.get("title"),120)||"Comunicado HSMC",
      subtitle:clean(form.get("subtitle"),180),
      date:clean(form.get("date"),10),
      type:clean(form.get("type"),40)||"Comunicado",
      body:clean(form.get("body"),5000),
      published:String(form.get("published"))==="true",
      featured:String(form.get("featured"))==="true",
      createdAt:new Date().toISOString()
    };
    await env.HSMC_GALLERY.put(NOTICE_PREFIX+id,JSON.stringify(item));
    return json({ok:true,notice:item},201);
  }
  if(action==="notice-update"&&request.method==="POST"){
    const body=await request.json().catch(()=>({})); const id=clean(body.id,80);
    const current=await env.HSMC_GALLERY.get(NOTICE_PREFIX+id,"json");
    if(!current)return json({error:"Comunicado no encontrado."},404);
    const item={...current,
      title:clean(body.title,120)||current.title,
      subtitle:clean(body.subtitle,180),
      date:clean(body.date,10),
      type:clean(body.type,40)||"Comunicado",
      body:clean(body.body,5000),
      published:!!body.published,
      featured:!!body.featured,
      updatedAt:new Date().toISOString()
    };
    await env.HSMC_GALLERY.put(NOTICE_PREFIX+id,JSON.stringify(item));
    return json({ok:true,notice:item});
  }
  if(action==="notice-delete"&&request.method==="POST"){
    const body=await request.json().catch(()=>({})); const id=clean(body.id,80);
    const current=await env.HSMC_GALLERY.get(NOTICE_PREFIX+id,"json");
    if(!current)return json({error:"Comunicado no encontrado."},404);
    const tasks=[env.HSMC_GALLERY.delete(NOTICE_PREFIX+id)];
    if(current.url)tasks.push(env.HSMC_GALLERY.delete(IMG_PREFIX+id));
    await Promise.all(tasks);
    return json({ok:true});
  }

  return json({error:"Operación no válida."},400);
}