export async function onRequestGet({env,params}){
  if(!env.HSMC_GALLERY)return new Response("Not found",{status:404});
  const id=String(params.key||"");
  if(!/^[a-f0-9-]{36}$/i.test(id))return new Response("Bad request",{status:400});
  const result=await env.HSMC_GALLERY.getWithMetadata("img:"+id,"arrayBuffer");
  if(!result.value)return new Response("Not found",{status:404});
  const headers=new Headers({
    "Content-Type":result.metadata?.contentType||"image/webp",
    "Cache-Control":"public, max-age=31536000, immutable",
    "X-Content-Type-Options":"nosniff"
  });
  return new Response(result.value,{headers});
}