import { useEffect, useState } from "react";
import { api } from "./api";
type Entry = {id:string;kind:string;title:string;content:string;status:string;evidence:string;source:string;revision:number};
type Memory = {
  baseline: {version:number;updated:string;principles:string[];checkpoints:{id:string;title:string;status:string;detail:string;evidence:string}[];gaps:string[]};
  direction:{vision:string;priorities:string;revision:number};entries:Entry[];total:number;page:number;
};
const statusNames:Record<string,string>={proposed:"Proposed",planned:"Planned",in_progress:"In progress",verified:"Verified",deferred:"Deferred"};
const empty = {kind:"idea",title:"",content:"",status:"proposed",evidence:""};
export function AfpManagement() {
  const [data,setData]=useState<Memory|null>(null),[direction,setDirection]=useState<Memory["direction"]|null>(null),
    [entry,setEntry]=useState({...empty}),[editing,setEditing]=useState<Entry|null>(null),
    [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),
    [history,setHistory]=useState<any[]|null>(null),[historyTitle,setHistoryTitle]=useState("");
  async function load(page=0) {
    const next=await api("/settings/afp?page="+page) as Memory;
    setData(next);setDirection(next.direction);
  }
  useEffect(()=>{void load().catch(e=>setError(e.message));},[]);
  async function run(fn:()=>Promise<void>) {
    setBusy(true);setError("");setNotice("");
    try {await fn();setNotice("AFP memory saved. The coordinator can read this update now.");}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function showHistory(id:string,title:string) {
    setError("");
    try {setHistory(await api("/settings/afp/history/"+id));setHistoryTitle(title);}
    catch(e){setError((e as Error).message);}
  }
  return <section className="settings-card afp-management" id="afp">
    <div className="settings-section-head"><div><p className="eyebrow">Personal applications, shared foundations</p><h2>AFP Management</h2></div><span className="settings-lock">Super admin</span></div>
    <p>Shape how injury.bot becomes AFP friendly. Keep the direction, track what works, and discuss the next improvement with your coordinator.</p>
    <div className="afp-actions"><a className="primary-button" href="/coordinator?topic=afp">Discuss AFP with the coordinator</a><a className="secondary-button" href="/api/settings/afp/memory.md" download>Download AFP memory</a><button disabled={busy} onClick={()=>void load(data?.page).catch(e=>setError(e.message))}>Refresh memory</button></div>
    <p className="muted">Text and voice share this memory. Try “What should we change next to make personal customizations easier?” or “Remember this AFP idea.” The coordinator can explore tradeoffs and save proposals. Coding, isolated forks and automatic deployment are future work.</p>
    {error&&<p role="alert" className="work-notice error">{error}</p>}{notice&&<p role="status" className="settings-saved">{notice}</p>}
    {!data||!direction?<p>Loading AFP memory…</p>:<>
      <form className="settings-form" onSubmit={e=>{e.preventDefault();void run(async()=>{await api("/settings/afp/direction",direction);await load(data.page);});}}>
        <h3>Direction and priorities</h3>
        <p className="muted">Platform product knowledge only. Keep client records, medical evidence and credentials in their existing private workspaces.</p>
        <label>AFP vision<textarea required maxLength={8000} rows={5} value={direction.vision} onChange={e=>setDirection({...direction,vision:e.target.value})}/></label>
        <label>What should we work toward next?<textarea maxLength={5000} rows={3} value={direction.priorities} onChange={e=>setDirection({...direction,priorities:e.target.value})} placeholder="Describe the user experience you want to improve."/></label>
        <div className="afp-actions"><button disabled={busy} className="primary-button">Save AFP direction</button><button type="button" onClick={()=>void showHistory("direction","Direction history")}>View direction history</button></div>
      </form>
      <h3>Current foundations</h3><p className="muted">Maintained with the application release. These foundations support AFP development; they do not certify compatibility.</p>
      <div className="afp-foundations">{data.baseline.checkpoints.map(c=><article key={c.id}><span className="eyebrow">{c.status}</span><h4>{c.title}</h4><p>{c.detail}</p><details><summary>Implementation reference</summary><p className="afp-reference">{c.evidence}</p></details></article>)}</div>
      <details className="afp-principles"><summary>AFP principles and remaining gaps</summary><h4>Principles</h4><ul>{data.baseline.principles.map(p=><li key={p}>{p}</li>)}</ul><h4>Still to build</h4><ul>{data.baseline.gaps.map(p=><li key={p}>{p}</li>)}</ul></details>
      <div className="settings-section-head"><div><h3>Progress and recommendations</h3><p className="muted">Conversation notes begin as proposals. Mark progress verified only after checking its implementation reference.</p></div><span>{data.total} records</span></div>
      <form className="settings-form afp-note-form" onSubmit={e=>{e.preventDefault();void run(async()=>{await api(editing?"/settings/afp/entries/"+editing.id:"/settings/afp/entries",{...entry,...(editing?{revision:editing.revision}:{})});setEntry({...empty});setEditing(null);await load(data.page);});}}>
        <h4>{editing?"Review AFP record":"Add an AFP note"}</h4>
        <div className="afp-fields"><label>Record type<select value={entry.kind} onChange={e=>setEntry({...entry,kind:e.target.value})}>{["idea","decision","progress","recommendation"].map(k=><option key={k} value={k}>{k[0].toUpperCase()+k.slice(1)}</option>)}</select></label><label>Progress status<select value={entry.status} onChange={e=>setEntry({...entry,status:e.target.value})}>{Object.entries(statusNames).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label></div>
        <label>Title<input required maxLength={180} value={entry.title} onChange={e=>setEntry({...entry,title:e.target.value})}/></label>
        <label>Note<textarea required maxLength={5000} rows={3} value={entry.content} onChange={e=>setEntry({...entry,content:e.target.value})}/></label>
        <label>Implementation or verification reference{entry.status!=="verified"&&" (optional)"}<input required={entry.status==="verified"} maxLength={2000} value={entry.evidence} onChange={e=>setEntry({...entry,evidence:e.target.value})} placeholder="PR, commit, test result or documented review"/></label>
        <div className="afp-actions"><button disabled={busy} className="primary-button">{editing?"Save AFP record":"Save AFP note"}</button>{editing&&<button type="button" onClick={()=>{setEditing(null);setEntry({...empty});}}>Cancel review</button>}</div>
      </form>
      {!data.entries.length&&<p className="muted">No discussion notes yet. Tell the coordinator your idea and ask her to remember it here.</p>}
      <div className="afp-entries">{data.entries.map(r=><article key={r.id}><div className="settings-section-head"><span className="eyebrow">{r.kind} · {r.source==="coordinator"?"Coordinator discussion":"Admin record"}</span><strong>{statusNames[r.status]}</strong></div><h4>{r.title}</h4><p className="afp-note">{r.content}</p>{r.evidence&&<p className="afp-reference">Reference: {r.evidence}</p>}<div className="afp-actions"><button disabled={busy} onClick={()=>{setEditing(r);setEntry(r);document.querySelector(".afp-note-form")?.scrollIntoView({block:"center"});}}>Review record</button><button onClick={()=>void showHistory(r.id,r.title)}>View history</button></div></article>)}</div>
      {data.total>20&&<div className="afp-actions"><button disabled={busy||data.page===0} onClick={()=>void load(data.page-1).catch(e=>setError(e.message))}>Newer notes</button><span>Page {data.page+1}</span><button disabled={busy||(data.page+1)*20>=data.total} onClick={()=>void load(data.page+1).catch(e=>setError(e.message))}>Older notes</button></div>}
      {history&&<aside className="afp-history"><h4>{historyTitle}</h4>{!history.length&&<p>No edits recorded yet.</p>}{history.map((h,i)=>{const v=JSON.parse(h.body);return <article key={i}><p className="muted">{new Date(h.created).toLocaleString()}</p><p className="afp-note">{v.content||v.vision}</p>{v.priorities&&<p>{v.priorities}</p>}{v.status&&<p>{statusNames[v.status]}</p>}{v.evidence&&<p className="afp-reference">{v.evidence}</p>}</article>;})}<button onClick={()=>setHistory(null)}>Close history</button></aside>}
    </>}
  </section>;
}
