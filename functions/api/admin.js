const INDEX_KEY="_gallery.json";
const COOKIE="hsmc_admin";
const MAX_AGE=60*60*8;

function json(data,status=200,headers={}){
  return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...headers}});
}
function clean(v,max=240){return String(v??"").trim().slice(0,max)}
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
  if(!env.HSMC_SESSION_SECRET)return false;
  const token=cookieValue(request,COOKIE); const [exp,sig]=token.split(".");
  if(!exp||!sig||Number(exp)<Math.floor(Date.now()/1000))return false;
  return sig===await hmac(exp,env.HSMC_SESSION_SECRET);
}
async function sameSecret(a,b){
  const enc=new TextEncoder();
  const [ha,hb]=await Promise.all([crypto.subtle.digest("SHA-256",enc.encode(String(a||""))),crypto.subtle.digest("SHA-256",enc.encode(String(b||"")))]);
  const A=new Uint8Array(ha),B=new Uint8Array(hb);let diff=0;for(let i=0;i<A.length;i++)diff|=A[i]^B[i];return diff===0;
}
async function readGallery(env){
  const obj=await env.HSMC_MEDIA.get(INDEX_KEY);
  if(!obj)return [];
  try{const data=JSON.parse(await obj.text());return Array.isArray(data)?data:[]}catch{return []}
}
async function saveGallery(env,items){
  await env.HSMC_MEDIA.put(INDEX_KEY,JSON.stringify(items),{httpMetadata:{contentType:"application/json"}});
}
function configured(env){return !!(env.HSMC_MEDIA&&env.HSMC_ADMIN_PASSWORD&&env.HSMC_SESSION_SECRET)}

export async function onRequest(context){
  const {request,env}=context;
  if(!configured(env))return json({error:"El panel aún no está conectado al almacenamiento seguro."},503);
  const url=new URL(request.url),action=url.searchParams.get("action")||"session";

  if(action==="login"&&request.method==="POST"){
    const body=await request.json().catch(()=>({}));
    if(!await sameSecret(body.password,env.HSMC_ADMIN_PASSWORD))return json({error:"Contraseña incorrecta."},401);
    const token=await makeToken(env.HSMC_SESSION_SECRET);
    return json({ok:true},200,{"Set-Cookie":COOKIE+"="+encodeURIComponent(token)+"; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age="+MAX_AGE});
  }
  if(action==="logout"&&request.method==="POST"){
    return json({ok:true},200,{"Set-Cookie":COOKIE+"=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0"});
  }
  if(!await isAuth(request,env))return json({error:"Sesión no autorizada."},401);
  if(action==="session")return json({ok:true});

  if(action==="list"&&request.method==="GET"){
    const photos=await readGallery(env);
    photos.sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
    return json({photos});
  }

  if(action==="upload"&&request.method==="POST"){
    const form=await request.formData();
    const image=form.get("image");
    if(!(image instanceof File)||!image.type.startsWith("image/"))return json({error:"Selecciona una imagen válida."},400);
    if(image.size>8*1024*1024)return json({error:"La imagen procesada supera 8 MB."},413);
    const id=crypto.randomUUID(),key=id+".webp";
    await env.HSMC_MEDIA.put("photos/"+key,image.stream(),{httpMetadata:{contentType:image.type||"image/webp",cacheControl:"public, max-age=31536000, immutable"}});
    const item={
      id,key,url:"/api/media/"+key,
      title:clean(form.get("title"),90)||"Festividad HSMC",
      date:clean(form.get("date"),10),
      category:clean(form.get("category"),60)||"Festividad 2026",
      description:clean(form.get("description"),240),
      published:String(form.get("published"))==="true",
      createdAt:new Date().toISOString()
    };
    const photos=await readGallery(env);photos.unshift(item);await saveGallery(env,photos);
    return json({ok:true,photo:item},201);
  }

  if(action==="update"&&request.method==="POST"){
    const body=await request.json().catch(()=>({})); const id=clean(body.id,80);
    const photos=await readGallery(env),idx=photos.findIndex(p=>p.id===id);
    if(idx<0)return json({error:"Fotografía no encontrada."},404);
    photos[idx]={...photos[idx],
      title:clean(body.title,90)||photos[idx].title,
      date:clean(body.date,10),
      category:clean(body.category,60)||"Festividad 2026",
      description:clean(body.description,240),
      published:!!body.published,
      updatedAt:new Date().toISOString()
    };
    await saveGallery(env,photos);return json({ok:true,photo:photos[idx]});
  }

  if(action==="delete"&&request.method==="POST"){
    const body=await request.json().catch(()=>({})); const id=clean(body.id,80);
    const photos=await readGallery(env),idx=photos.findIndex(p=>p.id===id);
    if(idx<0)return json({error:"Fotografía no encontrada."},404);
    const removed=photos[idx]; photos.splice(idx,1);
    await Promise.all([env.HSMC_MEDIA.delete("photos/"+removed.key),saveGallery(env,photos)]);
    return json({ok:true});
  }
  return json({error:"Operación no válida."},400);
}