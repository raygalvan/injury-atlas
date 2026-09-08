import { useEffect, useState } from "react";
import { api } from "./api";
export function AfpDevelopment() {
  const [data,setData]=useState<any>(null),[error,setError]=useState("");
  const load=()=>api("/afp/development").then(setData).catch(e=>setError(e.message));
  useEffect(()=>{void load();const timer=setInterval(()=>void load(),15000);return()=>clearInterval(timer)},[]);
  return <section className="settings-card"><h3>Owner development access</h3><p>The Coordinator can send coding work to a real GitHub worker. It can edit repository code, run commands and tests, open pull requests, and merge for deployment. These are shared application changes. Private Lab preferences remain separate.</p>
  {error&&<p role="alert">{error}</p>}{data&&<><label className="afp-lab-toggle"><input type="checkbox" checked={data.enabled} onChange={async e=>{try{await api("/afp/development/control",{enabled:e.target.checked});await load()}catch(e){setError((e as Error).message)}}}/> Enable owner coding access</label><p>{data.keyConfigured?"OpenAI credential connected.":"Connect an OpenAI API key in Settings."} The worker checks about every five minutes. GitHub scheduling may take longer. You may leave this page.</p><h4>Development tasks</h4>{data.jobs.length===0?<p>No coding tasks yet. Ask the Coordinator to make an application change.</p>:data.jobs.map((job:any)=><article key={job.id}><strong>{job.state.replaceAll("_"," ")}</strong><p>{job.request}</p><p>{job.result}</p>{job.run_id&&<a href={`https://github.com/raygalvan/injury-atlas/actions/runs/${job.run_id}`} target="_blank" rel="noreferrer">Worker details</a>} {job.pr_url&&<a href={job.pr_url} target="_blank" rel="noreferrer">Pull request</a>}<small>{new Date(job.created).toLocaleString()}</small></article>)}</>}
  </section>;
}
