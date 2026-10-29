import {useEffect,useRef} from 'react';
import type {ReactNode,ButtonHTMLAttributes} from 'react';
// Small offline SVG subset with Lucide / Feather-compatible geometry. See THIRD_PARTY_NOTICES.md.
const paths:Record<string,ReactNode>={
  film:<><rect x="2" y="2" width="20" height="20" rx="2.18"/><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5"/></>,
  folder:<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>,
  layers:<><path d="m12 3 10 5-10 5L2 8Z"/><path d="m2 12 10 5 10-5M2 16l10 5 10-5"/></>,
  image:<><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></>,
  captions:<><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 10h4M6 14h2m4 0h6m-4-4h4"/></>,
  sliders:<><path d="M21 4H14M10 4H3M21 12H12M8 12H3M21 20H16M12 20H3M14 1v6M8 9v6M16 17v6"/></>,
  audio:<><path d="M2 10v4M6 6v12M10 3v18M14 8v8M18 5v14M22 10v4"/></>,
  mic:<><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></>,
  music:<><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></>,
  shapes:<><path d="m8.3 3 6.4 11H2Z"/><circle cx="17.5" cy="17.5" r="4.5"/></>,
  undo:<><path d="M3 10h11a7 7 0 0 1 0 14M3 10l5-5M3 10l5 5" transform="translate(0 -3)"/></>,
  redo:<><path d="M21 7H10a7 7 0 0 0 0 14M21 7l-5-5m5 5-5 5"/></>,
  export:<><path d="M12 15V3m-4 4 4-4 4 4M4 14v6h16v-6"/></>,
  plus:<path d="M12 5v14M5 12h14"/>,minus:<path d="M5 12h14"/>,
  search:<><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
  play:<path d="m8 5 11 7-11 7Z"/>,pause:<><path d="M8 5v14M16 5v14"/></>,
  prev:<><path d="M5 5v14m14-14L8 12l11 7Z"/></>,next:<><path d="M19 5v14M5 5l11 7L5 19Z"/></>,
  maximize:<path d="M8 3H3v5m13-5h5v5m0 8v5h-5M8 21H3v-5"/>,
  safe:<><rect x="3" y="3" width="18" height="18" rx="1"/><path d="M8 7H7v2m10-2h-1M7 15v2h2m8-2v2h-2"/></>,
  check:<path d="m20 6-11 11-5-5"/>,x:<path d="m18 6-12 12M6 6l12 12"/>,
  chevron:<path d="m6 9 6 6 6-6"/>,right:<path d="m9 5 7 7-7 7"/>,
  settings:<><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/><circle cx="12" cy="12" r="4"/></>,
  shield:<><path d="m12 3 9 4v6c0 5-9 9-9 9s-9-4-9-9V7Z"/><path d="m8 12 3 3 5-6"/></>,
  alert:<><path d="m12 3 10 18H2Z"/><path d="M12 9v4m0 4h.01"/></>,
  spark:<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>,
  save:<><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/></>,
  lock:<><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></>,
  snap:<><path d="M6 3v9a6 6 0 0 0 12 0V3h-4v9a2 2 0 0 1-4 0V3ZM6 7h4m4 0h4"/></>,
  pointer:<path d="m3 3 7 18 3-8 8-3Z"/>,more:<><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  volume:<><path d="m11 5-6 4H2v6h3l6 4ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></>,
  mute:<><path d="m11 5-6 4H2v6h3l6 4ZM17 9l5 6m0-6-5 6"/></>,
  info:<><circle cx="12" cy="12" r="10"/><path d="M12 11v6m0-10h.01"/></>
};
export function Icon({name,size=16}:{name:string;size?:number}){return <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">{paths[name]||paths.sliders}</svg>;}
export function Button({icon,children,variant='secondary',...props}:ButtonHTMLAttributes<HTMLButtonElement>&{icon?:string;variant?:'secondary'|'primary'|'plain';children?:ReactNode}){return <button type="button" {...props} className={`button ${variant} ${props.className||''}`}>{icon&&<Icon name={icon}/>}<span>{children}</span></button>;}
export function IconButton({icon,label,shortcut,active,...props}:ButtonHTMLAttributes<HTMLButtonElement>&{icon:string;label:string;shortcut?:string;active?:boolean}){return <button type="button" {...props} aria-label={label} aria-pressed={active} title={`${label}${shortcut?` (${shortcut})`:''}`} className={`icon-button ${active?'active':''} ${props.className||''}`}><Icon name={icon}/></button>;}
export function Section({title,children,defaultOpen=true}:{title:string;children:ReactNode;defaultOpen?:boolean}){return <details className="property-section" open={defaultOpen||undefined}><summary>{title}<Icon name="chevron" size={13}/></summary><div>{children}</div></details>;}
export function Field({label,children,hint}:{label:string;children:ReactNode;hint?:string}){return <label className="field"><span>{label}</span>{children}{hint&&<small>{hint}</small>}</label>;}
export function NumberField({label,value,onChange,min,max,step=.01,disabled=false,suffix=''}:{label:string;value:number;onChange:(n:number)=>void;min?:number;max?:number;step?:number;disabled?:boolean;suffix?:string}){return <label className="number-field"><span>{label}</span><span><input type="number" aria-label={label} value={+value.toFixed(3)} min={min} max={max} step={step} disabled={disabled} onChange={e=>{const n=e.target.valueAsNumber;if(Number.isFinite(n))onChange(Math.min(max??Infinity,Math.max(min??-Infinity,n)));}}/>{suffix&&<em>{suffix}</em>}</span></label>;}
export function Modal({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null),close=useRef(onClose);close.current=onClose;
  useEffect(()=>{const d=dialog.current,previous=document.activeElement as HTMLElement|null;d?.showModal();return()=>{d?.close();previous?.focus();};},[]);
  return <dialog ref={dialog} className="modal" aria-label={title} onCancel={e=>{e.preventDefault();close.current();}} onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close.current();}}}><header><h2>{title}</h2><IconButton icon="x" label="Close dialog" onClick={onClose}/></header><div className="modal-body">{children}</div></dialog>;
}
