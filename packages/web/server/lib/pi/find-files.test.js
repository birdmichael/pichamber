import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findProjectFiles } from "./find-files.js";
const temps=[];
afterEach(()=>{for(const d of temps.splice(0)) fs.rmSync(d,{recursive:true,force:true})});
describe("findProjectFiles",()=>{
  it("returns relative paths and skips node_modules",()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"pi-find-"));
    temps.push(root);
    fs.mkdirSync(path.join(root,"src"),{recursive:true});
    fs.writeFileSync(path.join(root,"src","app.ts"),"export {}\n");
    fs.writeFileSync(path.join(root,"README.md"),"hi\n");
    fs.mkdirSync(path.join(root,"node_modules","x"),{recursive:true});
    fs.writeFileSync(path.join(root,"node_modules","x","skip.ts"),"no\n");
    const all=findProjectFiles(root,{type:"file"});
    expect(all).toEqual(expect.arrayContaining(["README.md","src/app.ts"]));
    expect(all.join("|")).not.toContain("node_modules");
    expect(findProjectFiles(root,{query:"app",type:"file"})).toEqual(["src/app.ts"]);
    expect(findProjectFiles(root,{query:"src",type:"directory",includeDirs:true})).toEqual(["src"]);
  });

  it("matches package.json for pack and package queries",()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"pi-find-pack-"));
    temps.push(root);
    fs.writeFileSync(path.join(root,"package.json"),"{}\n");
    fs.writeFileSync(path.join(root,"README.md"),"hi\n");
    fs.mkdirSync(path.join(root,"docs"),{recursive:true});
    fs.writeFileSync(path.join(root,"docs","guide.md"),"docs\n");
    fs.mkdirSync(path.join(root,"node_modules","x"),{recursive:true});
    fs.writeFileSync(path.join(root,"node_modules","x","package.json"),"{}\n");
    expect(findProjectFiles(root,{query:"pack",type:"file"})).toEqual(["package.json"]);
    expect(findProjectFiles(root,{query:"package",type:"file"})).toEqual(["package.json"]);
    expect(findProjectFiles(root,{query:"package.json",type:"file"})).toEqual(["package.json"]);
    expect(findProjectFiles(root,{query:"pack",type:"file"}).join("|")).not.toContain("node_modules");
  });
});
