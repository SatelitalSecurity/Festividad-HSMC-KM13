const INDEX_KEY="_gallery.json";
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"public, max-age=30"}})}
export async function onRequestGet({env}){
  if(!env.HSMC_MEDIA)return json({photos:[]});
  const obj=await env.HSMC_MEDIA.get(INDEX_KEY);
  if(!obj)return json({photos:[]});
  try{
    const data=JSON.parse(await obj.text());
    const photos=(Array.isArray(data)?data:[]).filter(p=>p&&p.published).sort((a,b)=>String(b.date||b.createdAt||"").localeCompare(String(a.date||a.createdAt||"")));
    return json({photos});
  }catch{return json({photos:[]})}
}