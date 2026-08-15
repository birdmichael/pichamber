import fs from "node:fs";
import path from "node:path";
const SKIP=new Set([".git","node_modules","dist","build","out",".next",".turbo",".cache","coverage",".venv","venv","__pycache__",".idea",".vscode","target"]);
const ALLOW=new Set([".pi",".agents",".github"]);
const isDir=(v)=>{try{return fs.statSync(v).isDirectory()}catch{return false}};
export const findProjectFiles=(directory,{query="",limit=100,includeDirs=true,type=null}={})=>{
  if(!directory||!isDir(directory)) return [];
  const needle=String(query||"").trim().toLowerCase();
  const max=Math.min(Math.max(Number(limit)||100,1),500);
  const results=[];
  const walk=(abs,rel)=>{
    if(results.length>=max) return;
    let entries=[];
    try{entries=fs.readdirSync(abs,{withFileTypes:true})}catch{return}
    entries.sort((a,b)=>a.name.localeCompare(b.name));
    for(const e of entries){
      if(results.length>=max) return;
      if(e.name==="."||e.name==="..") continue;
      if(e.isSymbolicLink&&e.isSymbolicLink()) continue;
      const r=rel?`${rel}/${e.name}`:e.name;
      const full=path.join(abs,e.name);
      const hit=!needle||r.toLowerCase().includes(needle);
      if(e.isDirectory()){
        if(SKIP.has(e.name)||(e.name.startsWith(".")&&!ALLOW.has(e.name))) continue;
        if(hit&&includeDirs&&type!=="file") results.push(r);
        walk(full,r);
      } else if(e.isFile()&&type!=="directory"&&hit){
        results.push(r);
      }
    }
  };
  walk(path.resolve(directory),"");
  return results;
};
