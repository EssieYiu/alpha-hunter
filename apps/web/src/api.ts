export async function api<T>(path:string, body?:unknown, method=body===undefined?'GET':'POST'):Promise<T>{
 const response=await fetch('/api'+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await response.json().catch(()=>null);
 if(!response.ok){const detail=data?.detail;throw new Error(typeof detail==='string'?detail:Array.isArray(detail)?detail.map((x:{msg:string})=>x.msg).join('；'):`请求失败（${response.status}）`)}
 if(data===null&&response.status!==204)throw new Error('API 返回格式不正确，请确认后端已启动');
 return data as T;
}
export type Index={id:string;name:string;code:string;market:string;category?:string;aliases?:string;value?:string;change?:string};
export type Point={time:number;value:number};
export type Bars={bars:{time:number;open:number;high:number;low:number;close:number;volume:number|null}[];indicators?:Record<string,Point[]>;provider:string;as_of:string|null;unavailable_reason:string|null;freshness?:string;freshness_reason?:string;stale?:boolean};
export type Strategy={id:string;name:string;type:string;period:string;fast:number;slow:number;lower:number;upper:number;description:string;version?:number};
export type Account={cash:string;positions:{ticker:string;quantity:string;cost:string}[];ledger:{id:string;ticker:string;side:string;quantity:string;price:string;fee:string;created_at:string}[]};
export type Run={id:string;status:string;error?:string;result?:{strategy_snapshot:Strategy;metrics:Record<string,string|number>;equity:{time:number;equity:string;benchmark:string;drawdown:string}[];trades:{time:number;side:string;price:string;quantity:string;fee:string}[];provider?:string;[key:string]:unknown}};
export type Conversation={id:string;title:string;created_at:string;messages?:{id:string;role:string;content:string;created_at:string;tool_calls?:{name:string;arguments:unknown;result:unknown;status:string}[]}[]};
