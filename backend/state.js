'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {randomBytes}=require('node:crypto');
function privateDirectory(directory){
  if(!path.isAbsolute(directory))throw Error('Absolute private state path required');
  directory=path.resolve(directory);
  const repo=fs.realpathSync(path.resolve(__dirname,'..'));
  let ancestor=directory;
  while(!fs.existsSync(ancestor))ancestor=path.dirname(ancestor);
  const destination=path.resolve(fs.realpathSync(ancestor),path.relative(ancestor,directory));
  if(destination!==directory)throw Error('Symlinked state path rejected');
  if(destination===repo || destination.startsWith(repo+path.sep))throw Error('Private state must be outside checkout');
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const st=fs.lstatSync(directory);
  if(!st.isDirectory() || st.isSymbolicLink() || (st.mode&0o077)!==0 || st.uid!==process.getuid())throw Error('State directory must be private and owned');
  if(fs.realpathSync(directory)!==path.resolve(directory))throw Error('Symlinked state path rejected');
  return directory;
}
function atomicJSON(file,value){
  const temp=file+'.'+randomBytes(8).toString('hex')+'.tmp';
  const fd=fs.openSync(temp,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(temp,file);
}
function readPrivateJSON(file){
  if(!file || !path.isAbsolute(file))throw Error('Absolute private credential path required');
  const repo=path.resolve(__dirname,'..');
  if(file.startsWith(repo+path.sep))throw Error('Credentials must be outside checkout');
  const real=fs.realpathSync(file);
  if(real===repo || real.startsWith(repo+path.sep))throw Error('Credentials must be outside checkout');
  const st=fs.lstatSync(file);
  if(st.nlink!==1 || !st.isFile() || st.isSymbolicLink() || st.uid!==process.getuid() || (st.mode&0o077)!==0)throw Error('Unsafe credential permissions');
  return JSON.parse(fs.readFileSync(file,'utf8'));
}
function createStore(directory){
  privateDirectory(directory);
  const file=id=>{if(!/^[0-9a-f]{32}$/.test(id))throw Error('Invalid plan');return path.join(directory,id+'.json');};
  return {
    read(id){const target=file(id),st=fs.lstatSync(target);if(!st.isFile() || st.isSymbolicLink() || st.uid!==process.getuid() || (st.mode&0o077)!==0)throw Error('Unsafe plan file');return JSON.parse(fs.readFileSync(target,'utf8'));},
    write(id,value){atomicJSON(file(id),value);},
    prune(now){
      for(const name of fs.readdirSync(directory)){
        if(!/^[0-9a-f]{32}\.json$/.test(name))continue;
        const id=name.slice(0,-5),value=this.read(id);
        if(value.expiresAt<=now && value.status!=='applying')fs.unlinkSync(file(id));
      }
    },
    async locked(fn){
      const lock=path.join(directory,'sync.lock');
      let fd;try{fd=fs.openSync(lock,'wx',0o600);}catch{throw Error('Another sync is active or recovery is required');}
      try{fs.writeFileSync(fd,String(process.pid));return await fn();}finally{fs.closeSync(fd);fs.unlinkSync(lock);}
    }
  };
}
module.exports={createStore,privateDirectory,atomicJSON,readPrivateJSON};
