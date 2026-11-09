import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';

const root=fileURLToPath(new URL('../src/',import.meta.url));
function files(directory:string):string[]{
  return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(join(directory,entry.name)):[join(directory,entry.name)]);
}
const paths=files(root).filter(path=>/\.(?:ts|js)$/.test(path));
const name=(path:string)=>relative(root,path).replaceAll('\\','/');
function dependencies(path:string,includeTypes=true):string[]{
  const source=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true),result:string[]=[];
  const add=(value:string)=>{if(!value.startsWith('.'))return;const target=resolve(dirname(path),value);
    const actual=[target,target+'.ts',target+'.js',join(target,'index.ts')].find(candidate=>existsSync(candidate));
    if(!actual)throw new Error(`${name(path)} imports missing ${value}`);result.push(actual);
  };
  function visit(node:ts.Node){
    if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)){
      const clause=node.importClause,bindings=clause?.namedBindings;
      const onlyTypes=clause?.isTypeOnly||(bindings&&ts.isNamedImports(bindings)&&bindings.elements.every(e=>e.isTypeOnly));
      if(includeTypes||!onlyTypes)add(node.moduleSpecifier.text);
    }else if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword&&ts.isStringLiteral(node.arguments[0]))add(node.arguments[0].text);
    else if(ts.isExportDeclaration(node)&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier)&&(includeTypes||!node.isTypeOnly))add(node.moduleSpecifier.text);
    ts.forEachChild(node,visit);
  }visit(source);return result;
}
it('keeps only the browser entry at src root and does not restore catch-all core/library directories',()=>{
  expect(paths.map(name).filter(p=>!p.includes('/'))).toEqual(['main.ts']);
  expect(paths.map(name).filter(p=>/^(core|library|rendering)\//.test(p))).toEqual([]);
});
it('uses single-word or abbreviated source and test filenames',()=>{
  expect(paths.map(name).filter(p=>!/(?:^|\/)[a-z][a-z0-9]*\.(?:ts|js)$/.test(p))).toEqual([]);
  const tests=files(fileURLToPath(new URL('./',import.meta.url))).filter(p=>p.endsWith('.test.ts'));
  expect(tests.filter(p=>!/[\\/][a-z][a-z0-9]*\.test\.ts$/.test(p))).toEqual([]);
});
it('resolves static and lazy imports after moves, including service-worker build paths',()=>{
  for(const path of paths)expect(()=>dependencies(path)).not.toThrow();
  const config=readFileSync(new URL('../vite.config.ts',import.meta.url),'utf8');
  const source=ts.createSourceFile('vite.config.ts',config,ts.ScriptTarget.Latest,true),workers:string[]=[];
  function visit(node:ts.Node){
    if(ts.isStringLiteral(node)&&/^src\/.*\.js$/.test(node.text))workers.push(node.text);
    ts.forEachChild(node,visit);
  }
  visit(source);
  expect(workers).toHaveLength(2);
  for(const worker of workers)expect(existsSync(resolve(root,'..',worker)),worker).toBe(true);
  expect(config).toContain("url === '/isolation-service-worker.js'");
  expect(config).toContain("resolve('dist/isolation-service-worker.js')");
});
it('keeps chart computation and gameplay independent of player, rendering and UI implementations',()=>{
  for(const path of paths.filter(p=>/^(chart|gameplay)\//.test(name(p)))){
    const forbidden=dependencies(path).map(name).filter(p=>/^(player|render|ui|app|audio)\//.test(p));
    expect(forbidden,`${name(path)} crosses its domain boundary`).toEqual([]);
  }
  expect(readFileSync(join(root,'gameplay/hits.ts'),'utf8')).not.toMatch(/\b(document|CanvasRenderingContext2D|HitEffectRenderer)\b/);
});
it('has no execution-time local import cycles',()=>{
  const graph=new Map(paths.map(p=>[p,dependencies(p,false)])),done=new Set<string>(),active:string[]=[];
  function visit(path:string){
    if(done.has(path))return;if(active.includes(path))throw new Error(active.concat(path).map(name).join(' -> '));
    active.push(path);for(const dependency of graph.get(path)||[])visit(dependency);active.pop();done.add(path);
  }
  for(const path of paths)expect(()=>visit(path)).not.toThrow();
});
