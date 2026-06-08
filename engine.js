/* ============================================================= *
 *  tau-bench engine — faithful JS port of sierra-research/tau-bench
 *  (tool backend + env.step semantics + calculate_reward)
 *  Shared by pipeline.html.
 * ============================================================= */
(function(global){
const RETAIL_DB = global.TAU_RETAIL_DB||{users:{},orders:{},products:{}};

const MUTATING = new Set([
  "cancel_pending_order","return_delivered_order_items","exchange_delivered_order_items",
  "modify_pending_order_items","modify_pending_order_address","modify_pending_order_payment",
  "modify_user_address","cancel_pending_order_items","partial_return_and_exchange",
  "book_reservation","cancel_reservation","send_certificate","update_reservation_baggages",
  "update_reservation_flights","update_reservation_passengers"
]);
const isMut = n => MUTATING.has(n);
const J = x => JSON.stringify(x);
const round2 = x => Math.round((x+Number.EPSILON)*100)/100;
function freshDB(){ return JSON.parse(JSON.stringify(RETAIL_DB)); }

/* ---- faithful retail tool backend (operates on a data dict, like Python invoke) ---- */
const RETAIL_BACKEND = {
  think:({thought})=>"",
  calculate:({expression})=>{ if(!/^[-0-9+*/(). ]+$/.test(expression||""))return "Error: invalid characters in expression";
    try{return String(round2(Function('"use strict";return ('+expression+')')()));}catch(e){return "Error: "+e.message;} },
  transfer_to_human_agents:({summary})=>"Transfer successful",
  list_all_product_types:(_,db)=>{const o={};Object.values(db.products).forEach(p=>o[p.name]=p.product_id);
    return J(Object.fromEntries(Object.entries(o).sort()));},
  find_user_id_by_name_zip:({first_name,last_name,zip},db)=>{for(const[id,p]of Object.entries(db.users)){
    if(p.name.first_name.toLowerCase()===(first_name||"").toLowerCase()&&p.name.last_name.toLowerCase()===(last_name||"").toLowerCase()&&p.address.zip===zip)return id;}return "Error: user not found";},
  find_user_id_by_email:({email},db)=>{for(const[id,p]of Object.entries(db.users)){if((p.email||"").toLowerCase()===(email||"").toLowerCase())return id;}return "Error: user not found";},
  get_user_details:({user_id},db)=> db.users[user_id]? J(db.users[user_id]) : "Error: user not found",
  get_order_details:({order_id},db)=> db.orders[order_id]? J(db.orders[order_id]) : "Error: order not found",
  get_product_details:({product_id},db)=> db.products[product_id]? J(db.products[product_id]) : "Error: product not found",
  cancel_pending_order:({order_id,reason},db)=>{const o=db.orders[order_id]; if(!o)return "Error: order not found";
    if(o.status!=="pending")return "Error: non-pending order cannot be cancelled";
    if(!["no longer needed","ordered by mistake"].includes(reason))return "Error: invalid reason";
    const refunds=[];for(const p of o.payment_history){const pid=p.payment_method_id;refunds.push({transaction_type:"refund",amount:p.amount,payment_method_id:pid});
      if(pid.includes("gift_card")){const pm=db.users[o.user_id].payment_methods[pid];pm.balance=round2(pm.balance+p.amount);}}
    o.status="cancelled";o.cancel_reason=reason;o.payment_history.push(...refunds);return J(o);},
  return_delivered_order_items:({order_id,item_ids,payment_method_id},db)=>{const o=db.orders[order_id]; if(!o)return "Error: order not found";
    if(o.status!=="delivered")return "Error: non-delivered order cannot be returned";
    const u=db.users[o.user_id]; if(!u.payment_methods[payment_method_id])return "Error: payment method not found";
    if(!payment_method_id.includes("gift_card")&&payment_method_id!==o.payment_history[0].payment_method_id)return "Error: payment method should be either the original payment method or a gift card";
    const all=o.items.map(i=>i.item_id);for(const it of item_ids){if(item_ids.filter(x=>x===it).length>all.filter(x=>x===it).length)return "Error: some item not found";}
    o.status="return requested";o.return_items=[...item_ids].sort();o.return_payment_method_id=payment_method_id;return J(o);},
  exchange_delivered_order_items:({order_id,item_ids,new_item_ids,payment_method_id},db)=>swapItems(db,order_id,item_ids,new_item_ids,payment_method_id,"delivered","exchange requested",true),
  modify_pending_order_items:({order_id,item_ids,new_item_ids,payment_method_id},db)=>swapItems(db,order_id,item_ids,new_item_ids,payment_method_id,"pending","item modified",false),
  modify_pending_order_address:({order_id,address1,address2,city,state,country,zip},db)=>{const o=db.orders[order_id];if(!o)return "Error: order not found";
    if(o.status!=="pending")return "Error: non-pending order cannot be modified";o.address={address1,address2,city,state,country,zip};return J(o);},
  modify_pending_order_payment:({order_id,payment_method_id},db)=>{const o=db.orders[order_id];if(!o)return "Error: order not found";
    if(o.status!=="pending")return "Error: non-pending order cannot be modified";const u=db.users[o.user_id];
    if(!u.payment_methods[payment_method_id])return "Error: payment method not found";
    if(o.payment_history.length>1||o.payment_history[0].transaction_type!=="payment")return "Error: there should be exactly one payment for a pending order";
    if(o.payment_history[0].payment_method_id===payment_method_id)return "Error: the new payment method should be different from the current one";
    const amount=o.payment_history[0].amount;const pm=u.payment_methods[payment_method_id];
    if(pm.source==="gift_card"&&pm.balance<amount)return "Error: insufficient gift card balance to pay for the order";
    o.payment_history.push({transaction_type:"payment",amount,payment_method_id},{transaction_type:"refund",amount,payment_method_id:o.payment_history[0].payment_method_id});
    o.payment_history[0].payment_method_id=payment_method_id;return J(o);},
  modify_user_address:({user_id,address1,address2,city,state,country,zip},db)=>{const u=db.users[user_id];if(!u)return "Error: user not found";
    u.address={address1,address2,city,state,country,zip};return J(u);},
};
function swapItems(db,order_id,item_ids,new_item_ids,payment_method_id,reqStatus,newStatus,isExchange){
  const o=db.orders[order_id]; if(!o)return "Error: order not found";
  if(o.status!==reqStatus)return `Error: non-${reqStatus} order cannot be ${isExchange?'exchanged':'modified'}`;
  const all=o.items.map(i=>i.item_id);
  for(const it of item_ids){if(item_ids.filter(x=>x===it).length>all.filter(x=>x===it).length)return `Error: ${it} not found`;}
  if(item_ids.length!==new_item_ids.length)return "Error: the number of items to be exchanged should match";
  const u=db.users[o.user_id]; if(!u.payment_methods[payment_method_id])return "Error: payment method not found";
  let diff=0; const swaps=[];
  for(let i=0;i<item_ids.length;i++){const it=o.items.find(x=>x.item_id===item_ids[i]&&!x._swapped);
    if(!it)return `Error: ${item_ids[i]} not found`;
    const prod=db.products[it.product_id];const nv=prod&&prod.variants[new_item_ids[i]];
    if(!nv||!nv.available)return `Error: new item ${new_item_ids[i]} not found or available`;
    diff+=nv.price-it.price; swaps.push([it,nv,new_item_ids[i]]);}
  diff=round2(diff);
  for(const[it,nv,nid]of swaps){it.item_id=nid;it.price=nv.price;it.options=nv.options;}
  if(isExchange){ o.status="exchange requested"; o.exchange_items=[...item_ids].sort(); o.exchange_new_items=[...new_item_ids].sort();
    o.exchange_payment_method_id=payment_method_id; o.exchange_price_difference=diff; }
  else { o.status="item modified"; o.payment_history.push(diff>0?{transaction_type:"payment",amount:diff,payment_method_id}:{transaction_type:"refund",amount:-diff,payment_method_id}); }
  return J(o);
}
// run a tool against a given db; returns observation string (env.step tool branch)
function invokeTool(domain,name,args,db){
  if(domain==="retail"&&RETAIL_BACKEND[name]){ try{return RETAIL_BACKEND[name](args||{},db);}catch(e){return "Error: "+e.message;} }
  return `(no local backend for ${name} — airline tools are stubbed in this build)`;
}

/* ---- to_hashable + consistent_hash (compare DB states like tau-bench) ---- */
function canonical(x){ if(Array.isArray(x))return x.map(canonical);
  if(x&&typeof x==="object"){const o={};Object.keys(x).sort().forEach(k=>o[k]=canonical(x[k]));return o;} return x; }
function canonStr(x){ return JSON.stringify(canonical(x)); }
async function sha256hex(str){ const buf=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join(""); }

/* ---- calculate_reward: replay gold on fresh DB, compare to agent DB ---- */
async function calculateReward(task, agentDB, agentRespondTexts){
  // build ground-truth DB by replaying gold tool actions on a fresh DB
  const gtDB = freshDB();
  const goldApplied = [];
  for(const a of (task.actions||[])){
    if(a.name==="respond") continue;
    const obs = invokeTool(task.domain, a.name, a.kwargs, gtDB);
    goldApplied.push({name:a.name,kwargs:a.kwargs,obs});
  }
  const agentCanon = canonStr(agentDB), gtCanon = canonStr(gtDB);
  const r_actions = agentCanon===gtCanon;
  const [agentHash, gtHash] = await Promise.all([sha256hex(agentCanon), sha256hex(gtCanon)]);

  // outputs: each must appear (lowercased, commas removed) in some respond content
  const outputs = {};
  let r_outputs = 1.0;
  for(const out of (task.outputs||[])){
    let found=false;
    for(const c of agentRespondTexts){ if((c||"").toLowerCase().replace(/,/g,"").includes(out.toLowerCase())){found=true;break;} }
    outputs[out]=found; if(!found) r_outputs=0.0;
  }
  const reward = (r_actions && r_outputs===1.0) ? 1.0 : 0.0;

  // diff: which orders/users differ between agent DB and ground-truth DB
  const diff = dbDiff(agentDB, gtDB);
  return {reward, r_actions, r_outputs, outputs, agentHash, gtHash, goldApplied, diff};
}
function dbDiff(a,b){
  const out=[];
  for(const table of ["orders","users","products"]){
    const ids=new Set([...Object.keys(a[table]||{}),...Object.keys(b[table]||{})]);
    for(const id of ids){
      const av=a[table]&&a[table][id], bv=b[table]&&b[table][id];
      if(canonStr(av)!==canonStr(bv)) out.push({table,id,agent:av,gold:bv});
    }
  }
  return out;
}

global.TAUENGINE = {MUTATING,isMut,freshDB,invokeTool,calculateReward,canonStr,sha256hex,dbDiff,RETAIL_BACKEND};
})(window);
