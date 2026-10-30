import { test, expect } from "bun:test";
import { readFileSync } from 'node:fs';
const path=new URL('./run.ts', import.meta.url).pathname;
const source=readFileSync(path,'utf8');
const transformed = new Bun.Transpiler({loader:'ts',target:'bun'}).transformSync(source
 .replace(/^import .*;\n/gm,'')
 .replace(/^export /gm,'')
 .replaceAll('import.meta.main','true')
 .replace('if (true) main().catch','return main().catch'));
async function replay(scenario: string) {
 let now=100000, handler:any, result:any, sends=0, reads=0, closed=false, injected=false;
 const model={providerId:'example',modelId:'plain'};
 const snapshot=()=>({session:{sessionId:'sess_fixture',model,status:'idle'},settings:{model:{current:model},thoughtLevel:{current:'max',available:[{value:'max'}],enabled:true}}});
 const push=(p:any)=>handler.onNotification({method:'session/event',params:{sessionId:'sess_fixture',payload:p}});
 const requestEvent=(type:string,id='r1')=>({type,requestId:id,model:{role:'main'},querySource:'main_turn'});
 class FakeServer {
  constructor(h:any){handler=h;}
  async request(method:string) {
   if(method==='session/create')return snapshot();
   if(method==='session/read') {
    reads++;
    if(scenario==='read-race' && reads===2)push(requestEvent('model_request_started','r2'));
    if(scenario==='read-error' && reads===2)push({type:'error',message:'quota exceeded'});
    if(scenario==='read-budget' && reads===2)now+=200000;
    return snapshot();
   }
   if(method==='session/send') {
    sends++;
    push(requestEvent('model_request_started'));
    push({type:'text_delta',delta:'Final reply'});
    push({...requestEvent('model_request_completed'),finishReason:'stop'});
    if(scenario.startsWith('backoff-') && sends===1)push({type:'model_error',message:'ECONNRESET'});
    if(scenario==='quota-tail' && sends===1)push({type:'model_error',requestId:'r1',details:'metadata '.repeat(22),message:'quota exhausted; permission denied'});
    if(scenario==='tool-error-repaired' && sends===1) {
     push(requestEvent('model_request_started','tool-turn'));
     push({...requestEvent('model_request_completed','tool-turn'),finishReason:'tool-calls'});
     push({type:'tool_start',toolCallId:'invented-failing-check'});
     push({type:'tool_error',toolCallId:'invented-failing-check',message:'invented check exited 7'});
     push(requestEvent('model_request_started','repair-turn'));
     push({type:'text_delta',delta:'Expected failure inspected; artifact repaired.'});
     push({...requestEvent('model_request_completed','repair-turn'),finishReason:'stop'});
    }
   }
   return {};
  }
  async close(){closed=true;}
  respond(){}
 }
 const proc={exitCode:0,exit(code:number){throw Error('unexpected exit '+code)},cwd(){return '/fixture'},stderr:{write(){}}};
 const values={'content-file':'fixture','workspace':'/fixture',model:'','provider':'example','collect-ms':'100000','quiet-sec':'1','tool-quiet-sec':'1','max-events':'100','max-run-min':'0','continues':'1',out:'/fixture/result.json'};
 const run=new Function('parseArgs','readFileSync','writeFileSync','mkdirSync','dirname','AppServer','syncAuthHeadless','startHeartbeat','Date','setTimeout','process','console',transformed);
 await run(()=>({values}),()=> 'brief',(_p:string,data:string)=>{result=JSON.parse(data)},()=>{},()=>'/fixture',FakeServer,()=>{},()=>()=>{}, {now:()=>now},(fn:()=>void,ms:number)=>{
 if(scenario.startsWith('backoff-') && ms>=30000 && !injected) {
  injected=true; now+=1;
  if(scenario==='backoff-final') {
   push(requestEvent('model_request_started','r2'));
   push({type:'text_delta',delta:'Final after recovery'});
   push({...requestEvent('model_request_completed','r2'),finishReason:'stop'});
  }
  if(scenario==='backoff-tool')push({type:'tool_start',toolCallId:'tool_fixture'});
  if(scenario==='backoff-error')push({type:'error',message:'quota exceeded'});
  if(scenario==='backoff-budget')now+=200000;
  now+=ms-1;
 } else now+=ms;
 fn();},proc,{log(){},error(){}});
 return {scenario,sends,reads,closed,exitCode:proc.exitCode,outcome:result?.outcome,pending:result?.nativeRequestsPending,lastErrorKind:result?.lastErrorKind,transportError:result?.transportError};
}
test("owning idle read is revalidated before settlement", async () => {
 const clean=await replay('clean');
 expect(clean.exitCode).toBe(0); expect(clean.sends).toBe(1);
 for(const scenario of ['read-race','read-error','read-budget']) {
  const result=await replay(scenario);
  expect(result.exitCode).not.toBe(0);
  expect(result.outcome).not.toBe('settled');
 }
});
test("late-field quota failure cannot authorize a second turn", async () => {
 const result=await replay('quota-tail');
 expect(result.exitCode).toBe(1); expect(result.outcome).toBe('error');
 expect(result.sends).toBe(1);
});

test("the model can inspect a failed tool and finish without a new parent turn", async () => {
 const result=await replay('tool-error-repaired');
 expect(result.exitCode).toBe(0);
 expect(result.outcome).toBe('settled');
 expect(result.sends).toBe(1);
 expect(result.pending).toBe(0);
 expect(result.transportError).toBe('');
});

test("progress or a stop during backoff revokes continuation eligibility", async () => {
 for(const scenario of ['backoff-final','backoff-tool','backoff-error','backoff-budget']) {
  const result=await replay(scenario);
  expect(result.sends).toBe(1);
  if(scenario==='backoff-final') expect(result.exitCode).toBe(0);
  else expect(result.exitCode).not.toBe(0);
 }
 const recovered=await replay('backoff-clean');
 expect(recovered.sends).toBe(2); expect(recovered.exitCode).toBe(0);
});
