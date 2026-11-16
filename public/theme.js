// Injected by the native host before the document is parsed.
(() => {
  let theme, fontSize;
  try {
    theme=localStorage.getItem('leafnote.dark')==='1'?'dark':'light';
    const raw=localStorage.getItem('leafnote.fontSize');
    const size=raw===null||raw===''?NaN:Number(raw);
    if([10,11,12,14,16,18,20,22,24,28,32,36].includes(size))fontSize=size;
  }
  catch { return; }
  const apply=()=>{
    if(!document.documentElement)return false;
    document.documentElement.dataset.theme=theme;
    if(fontSize)document.documentElement.style?.setProperty?.('--editor-font-size',fontSize+'px');
    return true;
  };
  if(!apply()){
    const observer=new MutationObserver(()=>{if(apply())observer.disconnect();});
    observer.observe(document,{childList:true});
  }
})();
