import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
const origin = "https://injury.bot", repository="raygalvan/injury-atlas";
const file=path.join(process.env.RUNNER_TEMP,"afp-task.json");
const mode=process.argv[2];
async function host(operation,body={}) {
  const tokenResponse=await fetch(process.env.ACTIONS_ID_TOKEN_REQUEST_URL+"&audience="+encodeURIComponent("injury.bot/afp-development"),{headers:{Authorization:`Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`}});
  if(!tokenResponse.ok)throw Error("GitHub runner identity unavailable");
  const {value}=await tokenResponse.json();
  const r=await fetch(`${origin}/api/afp/executor/${operation}`,{method:"POST",headers:{Authorization:`Bearer ${value}`,"Content-Type":"application/json"},body:JSON.stringify(body)});
  if(!r.ok)throw Error(`Development host returned ${r.status}`);
  return r.json();
}
function output(key,value){fs.appendFileSync(process.env.GITHUB_OUTPUT,`${key}=${value}\n`)}
async function github(endpoint,method="GET",body) {
 const r=await fetch(`https://api.github.com/repos/${repository}/${endpoint}`,{method,headers:{Authorization:`Bearer ${process.env.GH_TOKEN}`,Accept:"application/vnd.github+json","Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});
 if(!r.ok)throw Error(`GitHub ${method} ${endpoint.split('?')[0]} returned ${r.status}`);
 return r.status===204?null:r.json();
}
if(mode==="claim"){
 const r=await host("claim");output("has_task",r.job?"true":"false");
 if(r.job){
  if(!/^[\w-]{36}$/.test(r.job.id))throw Error("Invalid task ID");
  console.log(`::add-mask::${r.openaiKey}`);output("api_key",r.openaiKey);
  fs.writeFileSync(file,JSON.stringify(r.job),{mode:0o600});
  const prompt=`You are injury.bot's application-owner coding executor. The authenticated application owner explicitly authorizes repository inspection, code editing, shell/build/test execution and implementation of the following development request. There is no button/property allowlist. Earlier prohibitions on coding runtime in project notes do not apply to this owner development channel. Preserve other users' data. Do not put client evidence, credentials or account identifiers into git. Read AGENTS.md and committed AFP knowledge. Implement the request rather than merely proposing it. Run relevant tests. Do not commit or deploy yourself; the trusted publication stage will do that after independent tests. If asked for a private customization, implement an account-scoped capability rather than modifying all users' appearance. Do not claim features work without verifying them.\n\nOWNER REQUEST\n${r.job.request}\n`;
  const promptFile=path.join(process.env.RUNNER_TEMP,"afp-prompt.txt");fs.writeFileSync(promptFile,prompt,{mode:0o600});output("prompt_file",promptFile);
 }
}else if(mode==="publish"){
 const job=JSON.parse(fs.readFileSync(file,"utf8"));
 await host("authorize",{id:job.id});
 const git=(...args)=>execFileSync("git",args,{encoding:"utf8"}).trim();
 if(!git("status","--porcelain")){await host("complete",{id:job.id,state:"no_changes",result:"Worker produced no code changes. Inspect the worker run for its explanation."});process.exit(0)}
 const branch=`afp/task-${job.id}`;
 git("switch","-c",branch);git("config","user.name","injury.bot AFP");git("config","user.email","afp@users.noreply.github.com");git("add","-A");git("commit","-m",`AFP owner development task ${job.id}`);
 const sha=git("rev-parse","HEAD");git("push","origin",branch);
 const pr=await github("pulls","POST",{title:`AFP development ${job.id.slice(0,8)}`,head:branch,base:"main",body:`Owner development task ${job.id}.\n\n${job.request}\n\nWorker run: https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}\n\nIndependent application tests, deployment tests, host build, pinned atlas build and browser checks passed before publication.`});
 if(job.delivery==="deploy"){
   const merged=await github(`pulls/${pr.number}/merge`,"PUT",{sha,merge_method:"squash"});
   if(!merged.merged)throw Error("GitHub did not merge the tested PR");
   // GITHUB_TOKEN merges do not trigger push workflows. Explicitly dispatch the existing deploy workflow.
   await github("actions/workflows/deploy.yml/dispatches","POST",{ref:"main"});
   await host("complete",{id:job.id,state:"merged",prUrl:pr.html_url,commit:merged.sha,result:"Tests passed; PR merged and AWS deployment requested. Check the deployment run before treating this as live."});
 }else await host("complete",{id:job.id,state:"pull_request",prUrl:pr.html_url,commit:sha,result:"Tests passed. Pull request is ready and unmerged as requested."});
}else if(mode==="failed"&&fs.existsSync(file)){
 const job=JSON.parse(fs.readFileSync(file,"utf8"));
 await host("complete",{id:job.id,state:"failed",result:"Worker or verification failed. No successful deployment is claimed. Inspect the linked GitHub run for the exact failing step."});
}
