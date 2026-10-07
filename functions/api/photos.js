const META_PREFIX="meta:";
export async function onRequestGet({env}){
  if(!env.HSMC_GALLERY)return new Response(JSON.stringify({photos:[]}),{headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
  const out=[]; let cursor;
  do{
    const page=await env.HSMC_GALLERY.list({prefix:META_PREFIX,cursor});
    const vals=await Promise.all(page.keys.map(k=>env.HSMC_GALLERY.get(k.name,"json")));
    for(const v of vals)if(v&&v.published)out.push(v);
    cursor=page.list_complete?undefined:page.cursor;
  }while(cursor);
  out.sort((a,b)=>String(b.date||b.createdAt||"").localeCompare(String(a.date||a.createdAt||"")));
  return new Response(JSON.stringify({photos:out}),{headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"public, max-age=30"}});
}