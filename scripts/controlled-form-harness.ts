import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// The same hook/effect model as the existing Services form suites, shared by
// the appointment, Visit and user-designation checks. Actual form handlers,
// permissions, Service picker and transport adapters execute; no browser claim.
export const globals = globalThis as any;
export const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
type Frame = { hooks: any[]; cursor: number; mounted: boolean };
export class Renderer {
  frames = new Map<string, Frame>(); visited = new Set<string>(); frame!: Frame;
  layouts: (() => void)[] = []; passives: (() => void)[] = []; dirty = false; lateSetters = 0; tree: any;
  constructor(private component: any) {
    const effect = (run: () => any, deps: any[], layout: boolean) => {
      const frame = this.frame, index = frame.cursor++, previous = frame.hooks[index];
      if (!previous || deps.some((value, position) => !Object.is(value, previous.deps[position]))) {
        const next = { deps, cleanup: undefined as any, layout }; frame.hooks[index] = next;
        (layout ? this.layouts : this.passives).push(() => { if (frame.mounted) { previous?.cleanup?.(); next.cleanup = run(); } });
      }
    };
    globals.servicesTestHooks = {
      useMemo: (callback: any) => callback(),
      useState: (initial: any) => {
        const frame = this.frame, index = frame.cursor++;
        if (!(index in frame.hooks)) frame.hooks[index] = { value: typeof initial === 'function' ? initial() : initial };
        return [frame.hooks[index].value, (value: any) => {
          if (!frame.mounted) { this.lateSetters++; return; }
          frame.hooks[index].value = typeof value === 'function' ? value(frame.hooks[index].value) : value; this.dirty = true;
        }];
      },
      useRef: (initial: any) => {
        const frame = this.frame, index = frame.cursor++;
        if (!(index in frame.hooks)) frame.hooks[index] = { current: initial };
        return frame.hooks[index];
      },
      useEffect: (run: any, deps: any[]) => effect(run, deps, false),
      useLayoutEffect: (run: any, deps: any[]) => effect(run, deps, true),
    };
  }
  expand(node: any, location: string): any {
    if (Array.isArray(node)) return node.map((child, index) => this.expand(child, location + '/' + index));
    if (!node || typeof node !== 'object' || !node.props) return node;
    if (typeof node.type === 'function') {
      const key = location + ':' + node.type.name + ':' + (node.key ?? ''); this.visited.add(key);
      let frame = this.frames.get(key);
      if (!frame) { frame = { hooks: [], cursor: 0, mounted: true }; this.frames.set(key, frame); }
      this.frame = frame; frame.cursor = 0;
      return this.expand(node.type(node.props), key);
    }
    return { ...node, props: { ...node.props, children: this.expand(node.props.children, location + '/children') } };
  }
  render(props: any) {
    this.visited.clear(); this.dirty = false; this.tree = this.expand({ type: this.component, props }, 'root');
    for (const [key, frame] of this.frames) if (!this.visited.has(key)) {
      frame.mounted = false;
      frame.hooks.forEach(hook => { if (hook?.cleanup) hook.layout ? hook.cleanup() : this.passives.push(hook.cleanup); });
      this.frames.delete(key);
    }
    this.layouts.splice(0).forEach(run => run()); return this.tree;
  }
  unmount() { for (const frame of this.frames.values()) { frame.mounted = false; frame.hooks.forEach(hook => hook?.cleanup?.()); } this.frames.clear(); this.passives = []; }
}
export function find(node: any, predicate: (node: any) => boolean): any {
  if (Array.isArray(node)) { for (const child of node) { const result = find(child, predicate); if (result) return result; } }
  else if (node && typeof node === 'object') { if (predicate(node)) return node; return find(node.props?.children, predicate); }
}
export function text(node: any): string {
  return Array.isArray(node) ? node.map(text).join(' ') : node && typeof node === 'object' ? text(node.props?.children) : String(node ?? '');
}
export async function buildControlledForms(names: string[], target = process.cwd()) {
  const require = createRequire(path.join(target, 'package.json'));
  const temporary = await mkdtemp(path.join(tmpdir(), 'vine-controlled-performers-'));
  const saved = { fetch: globals.fetch, window: globals.window, document: globals.document, confirm: globals.confirm, alert: globals.alert };
  await symlink(path.join(target, 'node_modules'), path.join(temporary, 'node_modules'), 'dir');
  globals.servicesTestAuth = { currentUser: null };
  globals.servicesTestInvalidations = 0; globals.appointmentInvalidationListeners = new Set();
  globals.window = { addEventListener() {}, removeEventListener() {}, requestAnimationFrame(callback: any) { callback(); } };
  globals.document = { querySelector() { return null; } };
  globals.confirm = () => false; globals.alert = () => {};
  await writeFile(path.join(temporary, 'react.mjs'), `import actual from ${JSON.stringify(require.resolve('react'))};\n${['useState', 'useRef', 'useEffect', 'useLayoutEffect', 'useMemo'].map(name => `export const ${name}=(...args)=>globalThis.servicesTestHooks.${name}(...args);`).join('\n')}\nexport const createContext=actual.createContext,useContext=context=>context._currentValue;\nexport default {...actual,useState,useRef,useEffect,useLayoutEffect,useMemo,createContext,useContext};`);
  await writeFile(path.join(temporary, 'platform.mjs'), 'export const auth=globalThis.servicesTestAuth; export const db={};');
  await writeFile(path.join(temporary, 'data.mjs'), `export {captureProtectedRequestScope,protectedFetch,doc,updateDoc,addDoc,serverTimestamp} from "./foundation.mjs";
export function invalidateProtectedData(){globalThis.servicesTestInvalidations++;for(const f of globalThis.appointmentInvalidationListeners)f();}
export function subscribeProtectedDataInvalidation(f){globalThis.appointmentInvalidationListeners.add(f);return()=>globalThis.appointmentInvalidationListeners.delete(f);}
export const collection=(_db,name)=>({path:name}),query=(ref)=>ref,limit=()=>({}),orderBy=()=>({}),where=()=>({}),getDocs=async()=>({docs:[]});
export const onSnapshot=(ref,callback)=>{callback({docs:(globalThis.historyRows?.[ref.path]||[]).map(row=>({id:row.id,data:()=>row}))});return()=>{};};`);
  await writeFile(path.join(temporary, 'time.mjs'), "export const getActiveDatePrefix=()=> '2035-01-01';export const getActiveDateTimeInput=()=> '2035-01-01T09:00';export const formatTimezone=value=>value;");
  await writeFile(path.join(temporary, 'utils.mjs'), 'export const formatDateTime=value=>value;');
  await writeFile(path.join(temporary, 'attachments.mjs'), 'export default ()=>null;');
  await writeFile(path.join(temporary, 'calendar.mjs'), `import React from ${JSON.stringify(require.resolve('react'))};export const dateFnsLocalizer=()=>({});export const Calendar=props=>React.createElement('div',{'data-controlled-calendar':true,events:props.events,tooltipAccessor:props.tooltipAccessor});`);
  await writeFile(path.join(temporary, 'date.mjs'), `import React from ${JSON.stringify(require.resolve('react'))};export const CustomDatePicker=props=>React.createElement('input',{...props,'data-controlled-date':true});`);
  const plugins = [{ name: 'controlled-performer-forms', setup(builder: any) {
    builder.onResolve({ filter: /^react$/ }, () => ({ path: path.join(temporary, 'react.mjs') }));
    builder.onResolve({ filter: /session$/ }, () => ({ path: path.join(temporary, 'platform.mjs') }));
    builder.onResolve({ filter: /foundation\.mjs$/ }, () => ({ path: path.join(temporary, 'foundation.mjs'), external: true }));
    builder.onResolve({ filter: /platform$/ }, () => ({ path: path.join(temporary, 'platform.mjs') }));
    builder.onResolve({ filter: /dataClient$/ }, () => ({ path: path.join(temporary, 'data.mjs') }));
    builder.onResolve({ filter: /utils\/timezone$/ }, () => ({ path: path.join(temporary, 'time.mjs') }));
    builder.onResolve({ filter: /^\.\.\/utils$/ }, () => ({ path: path.join(temporary, 'utils.mjs') }));
    builder.onResolve({ filter: /FileAttachmentSection$/ }, () => ({ path: path.join(temporary, 'attachments.mjs') }));
    builder.onResolve({ filter: /CustomDatePicker$/ }, () => ({ path: path.join(temporary, 'date.mjs') }));
    builder.onResolve({ filter: /^react-big-calendar$/ }, () => ({ path: path.join(temporary, 'calendar.mjs') }));
  } }];
  await build({ entryPoints: [path.join(target, 'src/dataClient.ts')], outfile: path.join(temporary, 'foundation.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external', plugins });
  const components: Record<string, any> = {};
  for (const name of names) {
    const outfile = path.join(temporary, name + '.mjs');
    await build({ entryPoints: [path.join(target, 'src/components/' + name + '.tsx')], outfile, bundle: true, platform: 'node', format: 'esm', jsx: 'transform', packages: 'external', plugins });
    components[name] = (await import(pathToFileURL(outfile).href)).default;
  }
  return { components, async cleanup() { Object.assign(globals, saved); await rm(temporary, { recursive: true, force: true }); } };
}
