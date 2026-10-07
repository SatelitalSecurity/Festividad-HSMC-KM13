const REPO="SatelitalSecurity/Festividad-HSMC-KM13";
const BRANCH="main";
const INDEX_PATH="gallery.json";
const PHOTO_DIR="assets/galeria";
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
  if(!env.HSMC_ADMIN_PASSWORD)return false;
  const token=cookieValue(request,COOKIE); const [exp,sig]=token.split(".");
  if(!exp||!sig||Number(exp)<Math.floor(Date.now()/1000))return false;
  return sig===await hmac(exp,env.HSMC_ADMIN_PASSWORD);
}
async function sameSecret(a,b){
  const enc=new TextEncoder();
  const [ha,hb]=await Promise.all([crypto.subtle.digest("SHA-256",enc.encode(String(a||""))),crypto.subtle.digest("SHA-256",enc.encode(String(b||"")))]);
  const A=new Uint8Array(ha),B=new Uint8Array(hb);let diff=0;for(let i=0;i<A.length;i++)diff|=A[i]^B[i];return diff===0;
}
function ghHeaders(env){
  return {
    "Authorization":"Bearer "+env.GITHUB_TOKEN,
    "Accept":"application/vnd.github+json",
    "X-GitHub-Api-Version":"2022-11-28",
    "User-Agent":"HSMC-KM13-Admin"
  };
}
async function gh(env,path,options={}){
  const r=await fetch("https://api.github.com"+path,{...options,headers:{...ghHeaders(env),...(options.headers||{})}});
  const text=await r.text();
  let data={}; try{data=text?JSON.parse(text):{}}catch{data={message:text}}
  if(!r.ok)throw new Error(data.message||("GitHub HTTP "+r.status));
  return data;
}
function bytesToBase64(buf){
  const bytes=new Uint8Array(buf); let binary="";
  const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,Math.min(i+chunk,bytes.length)));
  return btoa(binary);
}
function utf8ToBase64(str){return bytesToBase64(new TextEncoder().encode(str))}
function base64ToUtf8(b64){
  const clean=b64.replace(/\n/g,""); const bin=atob(clean); const bytes=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
async function getGallery(env){
  try{
    const d=await gh(env,"/repos/"+REPO+"/contents/"+INDEX_PATH+"?ref="+BRANCH);
    const arr=JSON.parse(base64ToUtf8(d.content||""));
    return Array.isArray(arr)?arr:[];
  }catch(e){
    if(String(e.message).includes("Not Found"))return [];
    throw e;
  }
}
async function getHead(env){
  const ref=await gh(env,"/repos/"+REPO+"/git/ref/heads/"+BRANCH);
  const commitSha=ref.object.sha;
  const commit=await gh(env,"/repos/"+REPO+"/git/commits/"+commitSha);
  return {commitSha,treeSha:commit.tree.sha};
}
async function createBlob(env,content,encoding){
  const d=await gh(env,"/repos/"+REPO+"/git/blobs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({content,encoding})});
  return d.sha;
}
async function commitTree(env,treeEntries,message){
  const head=await getHead(env);
  const tree=await gh(env,"/repos/"+REPO+"/git/trees",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({base_tree:head.treeSha,tree:treeEntries})});
  const commit=await gh(env,"/repos/"+REPO+"/git/commits",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message,tree:tree.sha,parents:[head.commitSha]})});
  await gh(env,"/repos/"+REPO+"/git/refs/heads/"+BRANCH,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({sha:commit.sha,force:false})});
  return commit.sha;
}
async function saveGallery(env,items,extraEntries=[],message="Actualizar galería HSMC"){
  const gallerySha=await createBlob(env,JSON.stringify(items,null,2)+"\n","utf-8");
  return commitTree(env,[...extraEntries,{path:INDEX_PATH,mode:"100644",type:"blob",sha:gallerySha}],message);
}
function configured(env){return !!(env.HSMC_ADMIN_PASSWORD&&env.GITHUB_TOKEN)}

export async function onRequest(context){
  const {request,env}=context;
  if(!configured(env))return json({error:"Falta configurar HSMC_ADMIN_PASSWORD y GITHUB_TOKEN en Cloudflare."},503);
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
    const photos=await getGallery(env);
    photos.sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
    return json({photos});
  }

  if(action==="upload"&&request.method==="POST"){
    const form=await request.formData();
    const image=form.get("image");
    if(!(image instanceof File)||!image.type.startsWith("image/"))return json({error:"Selecciona una imagen válida."},400);
    if(image.size>8*1024*1024)return json({error:"La imagen procesada supera 8 MB."},413);

    const id=crypto.randomUUID(),fileName=id+".webp",path=PHOTO_DIR+"/"+fileName;
    const imageB64=bytesToBase64(await image.arrayBuffer());
    const imageSha=await createBlob(env,imageB64,"base64");
    const item={
      id,
      path,
      url:"/"+path,
      title:clean(form.get("title"),90)||"Festividad HSMC",
      date:clean(form.get("date"),10),
      category:clean(form.get("category"),60)||"Festividad 2026",
      description:clean(form.get("description"),240),
      published:String(form.get("published"))==="true",
      createdAt:new Date().toISOString()
    };
    const photos=await getGallery(env); photos.unshift(item);
    const commit=await saveGallery(env,photos,[{path,mode:"100644",type:"blob",sha:imageSha}],"Galería HSMC: añadir fotografía");
    return json({ok:true,photo:item,commit},201);
  }

  if(action==="update"&&request.method==="POST"){
    const body=await request.json().catch(()=>({})); const id=clean(body.id,80);
    const photos=await getGallery(env),idx=photos.findIndex(p=>p.id===id);
    if(idx<0)return json({error:"Fotografía no encontrada."},404);
    photos[idx]={...photos[idx],
      title:clean(body.title,90)||photos[idx].title,
      date:clean(body.date,10),
      category:clean(body.category,60)||"Festividad 2026",
      description:clean(body.description,240),
      published:!!body.published,
      updatedAt:new Date().toISOString()
    };
    const commit=await saveGallery(env,photos,[],"Galería HSMC: actualizar fotografía");
    return json({ok:true,photo:photos[idx],commit});
  }

  if(action==="delete"&&request.method==="POST"){
    const body=await request.json().catch(()=>({})); const id=clean(body.id,80);
    const photos=await getGallery(env),idx=photos.findIndex(p=>p.id===id);
    if(idx<0)return json({error:"Fotografía no encontrada."},404);
    const removed=photos[idx]; photos.splice(idx,1);
    const commit=await saveGallery(env,photos,[{path:removed.path,mode:"100644",type:"blob",sha:null}],"Galería HSMC: eliminar fotografía");
    return json({ok:true,commit});
  }
  return json({error:"Operación no válida."},400);
}