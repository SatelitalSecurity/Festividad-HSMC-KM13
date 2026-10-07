export async function onRequestGet({env,params}){
  if(!env.HSMC_MEDIA)return new Response("Not found",{status:404});
  const key=String(params.key||"");
  if(!/^[a-zA-Z0-9._-]+$/.test(key))return new Response("Bad request",{status:400});
  const obj=await env.HSMC_MEDIA.get("photos/"+key);
  if(!obj)return new Response("Not found",{status:404});
  const headers=new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("ETag",obj.httpEtag);
  headers.set("Cache-Control","public, max-age=31536000, immutable");
  headers.set("X-Content-Type-Options","nosniff");
  return new Response(obj.body,{headers});
}