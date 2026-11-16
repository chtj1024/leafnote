const fs=require('node:fs'),path=require('node:path');
function paintFixture(root){
  const server=require(path.join(root,'server.js')).createServer(),handle=server.listeners('request')[0];server.removeAllListeners('request');
  const scripts={
    '/seed.js':"localStorage.setItem('leafnote.dark','1');location.replace('/');",
    '/probe.js':"let frames=0;function probe(){if(document.body){chrome.webview.postMessage('probe-color:'+getComputedStyle(document.body).backgroundColor+'|'+document.documentElement.dataset.theme);frames++;}if(frames<12)requestAnimationFrame(probe);}requestAnimationFrame(probe);"
  };
  server.on('request',(req,res)=>{
    const pathname=new URL(req.url,'http://127.0.0.1').pathname;
    if(scripts[pathname]){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});res.end(scripts[pathname]);return;}
    if(pathname==='/seed'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'self'"});res.end('<!doctype html><script src="/seed.js"></script>');return;}
    if(pathname==='/'){
      const end=res.end.bind(res);res.end=(data,...args)=>end(String(data).replace('</head>','<script src="/probe.js"></script></head>'),...args);
    }
    if(pathname==='/app.js')setTimeout(()=>handle(req,res),180);else handle(req,res);
  });
  return server;
}
module.exports={paintFixture};
