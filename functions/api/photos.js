export async function onRequestGet({request}){
  const url=new URL(request.url);
  const target=url.origin+"/gallery.json?ts="+Date.now();
  const r=await fetch(target,{cf:{cacheTtl:0,cacheEverything:false}});
  if(!r.ok)return new Response(JSON.stringify({photos:[]}),{headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
  let data=[]; try{data=await r.json()}catch{}
  const photos=(Array.isArray(data)?data:[]).filter(p=>p&&p.published).sort((a,b)=>String(b.date||b.createdAt||"").localeCompare(String(a.date||a.createdAt||"")));
  return new Response(JSON.stringify({photos}),{headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
}