'use strict';
const fs=require('node:fs'),path=require('node:path'),util=require('node:util');
const logs=process.env.LEAFNOTE_LOG_DIR;
if(logs){
  fs.mkdirSync(logs,{recursive:true});
  for(const [method,file] of [['log','server.log'],['error','error.log']])console[method]=(...values)=>{
    try{fs.appendFileSync(path.join(logs,file),util.format(...values)+'\n');}catch{}
  };
}
const {createServer}=require('./server'),port=Number(process.env.LEAFNOTE_PORT||43127),server=createServer();
server.on('error',error=>{console.error(error);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log('Leafnote: http://127.0.0.1:'+server.address().port));
