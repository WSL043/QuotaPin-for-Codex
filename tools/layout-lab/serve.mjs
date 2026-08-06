import http from "node:http";
import fs from "node:fs";
import { loadRendererSource } from "../../scripts/check-renderer-source.mjs";
import { createSettingsStateToolkit } from "../../src/renderer/settings-state.mjs";
import { createLayoutStateToolkit } from "../../src/renderer/layout-state.mjs";
import { createGestureStateToolkit } from "../../src/renderer/gesture-state.mjs";
import { createEffectStateToolkit } from "../../src/renderer/effect-state.mjs";
import { createI18nToolkit } from "../../src/renderer/i18n-state.mjs";
import { createCommandStateToolkit } from "../../src/renderer/command-state.mjs";
import { createColorStateToolkit } from "../../src/renderer/color-state.mjs";
import { createTimeStateToolkit } from "../../src/renderer/time-state.mjs";
import { createCodeConfigStateToolkit } from "../../src/renderer/code-config-state.mjs";
import { createProfileUsageStateToolkit } from "../../src/renderer/profile-usage-state.mjs";
import { DEFAULT_CONFIG, LAYOUT_MODULES, sanitizeConfig } from "../../src/core/config.mjs";
import { formatQuota } from "../../src/core/format.mjs";
import { normalizeRateLimits } from "../../src/core/model.mjs";

const port = 4187;
const accountAvatar = fs.readFileSync(new URL("../../assets/quotapin-icon.png", import.meta.url));
const renderer = `globalThis.__quotaPinRendererToolkits = {
  settings: ${createSettingsStateToolkit.toString()},
  layout: ${createLayoutStateToolkit.toString()},
  gesture: ${createGestureStateToolkit.toString()},
  effect: ${createEffectStateToolkit.toString()},
  i18n: ${createI18nToolkit.toString()},
  command: ${createCommandStateToolkit.toString()},
  color: ${createColorStateToolkit.toString()},
  time: ${createTimeStateToolkit.toString()},
  codeConfig: ${createCodeConfigStateToolkit.toString()},
  profileUsage: ${createProfileUsageStateToolkit.toString()}
};\n${loadRendererSource()}`;

const preferences = sanitizeConfig(DEFAULT_CONFIG);
const fixtureNow = Date.now();
const usage = normalizeRateLimits({ primary: { usedPercent: 58, windowDurationMins: 10080, resetsAt: fixtureNow / 1000 + 4 * 86400 + 8 * 3600 } });
const view = formatQuota(usage, preferences, fixtureNow, "en-US");

const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>QuotaPin Layout Lab</title><style>
html,body{height:100%;margin:0;background:#050505;color:#eee;font:14px system-ui,sans-serif;overflow:hidden}body:before{content:"Isolated renderer fixture";position:fixed;top:16px;left:16px;color:#666;font:12px ui-monospace,monospace}
#account{position:fixed;left:8px;bottom:8px;width:212px;height:40px;display:flex;align-items:center;gap:8px;padding:0 8px;border:0;border-radius:8px;background:#111;color:#ddd;text-align:left}#account img{width:18px;height:18px;border-radius:50%;background:#0b0d0d;object-fit:cover}#account .name{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
</style></head><body><button id="account" aria-haspopup="menu"><img alt=""><span class="name">Aster</span></button><script src="/renderer.js"></script><script>
window.__layoutLabActions=[];
const labPreferences=${JSON.stringify(preferences)}; const labView=${JSON.stringify(view)}; const labParams=new URLSearchParams(location.search);
document.querySelector("#account img").src="/account-avatar.png";
const labName=labParams.get("name"); document.querySelector("#account .name").textContent=(labName??"Aster").slice(0,80);
if(labParams.get("nativeName")==="hidden") document.querySelector("#account .name").style.display="none";
const labWidthRaw=labParams.get("width"); const labWidth=labWidthRaw===null?Number.NaN:Number(labWidthRaw); if(Number.isFinite(labWidth)) document.querySelector("#account").style.width=Math.max(180,Math.min(260,labWidth))+"px";
const labScaleRaw=labParams.get("scale"); const labScale=labScaleRaw===null?Number.NaN:Number(labScaleRaw); if(Number.isFinite(labScale)&&labScale>0) { document.querySelector("#account").style.transform="scale("+Math.max(1,Math.min(2.5,labScale))+")"; document.querySelector("#account").style.transformOrigin="bottom left"; }
if(labParams.get("layout")==="free") { labPreferences.profiles[0].layoutMode="free"; labView.layout.layoutMode="free"; }
const labModules=${JSON.stringify(LAYOUT_MODULES)};
const labCase=labParams.get("case")??labParams.get("demo")??"default";
const profile=labPreferences.profiles[0];
const quotaKeys={dot:"showDot",value:"showValue",todayTokens:"showTodayTokens",lifetimeTokens:"showLifetimeTokens",label:"showLabel",countdown:"showCountdown",relative:"showRelative",seconds:"showSeconds",date:"showDate",reset:"showReset"};
if(labCase==="all") Object.assign(profile,{identity:"show",showDot:true,showTodayTokens:true,showLifetimeTokens:true,showLabel:true,showCountdown:true,showRelative:true,showSeconds:true,showDate:true,showReset:true});
if(labCase==="name-only") Object.assign(profile,{identity:"hideAvatar",showDot:false,showValue:false,showTodayTokens:false,showLifetimeTokens:false,showLabel:false,showCountdown:false,showRelative:false,showSeconds:false,showDate:false,showReset:false});
if(labCase==="value-only") Object.assign(profile,{identity:"quotaOnly",showDot:false,showValue:true,showTodayTokens:false,showLifetimeTokens:false,showLabel:false,showCountdown:false,showRelative:false,showSeconds:false,showDate:false,showReset:false});
if(labCase==="default-date") Object.assign(profile,{identity:"show",showDot:false,showValue:true,showTodayTokens:false,showLifetimeTokens:false,showLabel:false,showCountdown:false,showRelative:false,showSeconds:false,showDate:true,showReset:false});
if(labCase==="default-seconds") {
  Object.assign(profile,{identity:"show",showDot:false,showValue:true,showTodayTokens:false,showLifetimeTokens:false,showLabel:false,showCountdown:false,showRelative:false,showSeconds:true,showDate:false,showReset:false});
  const soon=Math.floor(Date.now()/1000)+299;
  if(labView.runtimeWindows?.[0]) labView.runtimeWindows[0].resetsAt=soon;
  labView.parts.seconds="00:04:59";
}
if(["seconds","date","countdown","reset"].includes(labCase)) {
  Object.assign(profile,{identity:"quotaOnly",showDot:false,showValue:false,showTodayTokens:false,showLifetimeTokens:false,showLabel:false,showCountdown:false,showRelative:false,showSeconds:false,showDate:false,showReset:false});
  profile[quotaKeys[labCase]]=true;
}
const avatarShape=labParams.get("avatar"); if(["native","rounded","square"].includes(avatarShape)) profile.avatarShape=avatarShape;
for(const module of labModules){ const raw=labParams.get("anchor."+module); const requested=raw===null?Number.NaN:Number(raw); if(Number.isFinite(requested)) profile.moduleAnchors[module]=Math.max(0,Math.min(1,requested)); }
function syncLabView(){
  const profile=labPreferences.profiles.find((item)=>item.id===labPreferences.activeProfile)??labPreferences.profiles[0];
  for(const key of ["displayMode","showValue","showDot","showTodayTokens","showLifetimeTokens","showLabel","showCountdown","showRelative","showSeconds","showDate","showReset","effect","effectTarget","effectAt"]){ labView[key]=profile[key]; }
  labView.profileId=profile.id; labView.profileName=profile.name;
  labView.layout={ moduleOrder:[...profile.moduleOrder], layoutMode:profile.layoutMode, snapThreshold:profile.snapThreshold, snapTargets:[...profile.snapTargets], moduleAnchors:{...profile.moduleAnchors}, identity:profile.identity, avatarShape:profile.avatarShape, fontSize:profile.fontSize };
}
function applyLabAction(action){
  if(action.type==="updateProfile") labPreferences.profiles=labPreferences.profiles.map((profile)=>profile.id===action.id?{...profile,...action.patch,id:profile.id}:profile);
  else if(action.type==="updateLocale") labPreferences.locale=action.locale;
  else if(action.type==="updateThresholds") Object.assign(labPreferences.thresholds,action.patch);
  else if(action.type==="updatePalette") Object.assign(labPreferences.palette,action.patch);
  else if(action.type==="updateExperiments") Object.assign(labPreferences.experiments,action.patch);
  else if(action.type==="selectProfile") labPreferences.activeProfile=action.id;
  else if(action.type==="replaceConfig") Object.assign(labPreferences,action.config);
  syncLabView();
}
window.quotapinConfigAction=(payload)=>{
  const message=JSON.parse(payload); window.__layoutLabActions.push(message);
  document.documentElement.dataset.labActions=JSON.stringify(window.__layoutLabActions.slice(-4));
  if(labParams.get("ack")==="fail") {
    queueMicrotask(()=>window.__quotaPinController.update({status:"ready",view:labView,preferences:labPreferences,settingsAck:{actionId:message.actionId,ok:false,error:{code:"save_failed",message:"Fixture rejected the save"},preferences:labPreferences}}));
    return;
  }
  applyLabAction(message.action);
  queueMicrotask(()=>window.__quotaPinController.update({status:"ready",view:labView,preferences:labPreferences,settingsAck:{actionId:message.actionId,ok:true,preferences:labPreferences}}));
};
syncLabView();
window.__quotaPinController.update({status:"ready",view:labView,preferences:labPreferences});
window.__layoutLabGeometry=[];
window.__layoutLabSnapshot=()=>{
  const row=document.querySelector("#account"); const rowRect=row.getBoundingClientRect(); const result={case:labCase,layout:profile.layoutMode,avatarShape:profile.avatarShape,row:{left:rowRect.left,right:rowRect.right,top:rowRect.top,height:rowRect.height},modules:{}};
  for(const id of labModules){
    const node=["dot","value","label","countdown","relative","seconds","date","reset"].includes(id)?document.querySelector('#quotapin-inline-badge [data-part="'+id+'"]'):document.querySelector('#account [data-quotapin-module="'+id+'"]');
    if(!node) continue; const rect=node.getBoundingClientRect(); const style=getComputedStyle(node); result.modules[id]={visible:style.display!=="none"&&rect.width>0&&rect.height>0,left:rect.left,width:rect.width,center:rect.left+rect.width/2,verticalError:Math.abs((rect.top+rect.height/2)-(rowRect.top+rowRect.height/2)),borderRadius:style.borderRadius,text:node.textContent?.trim()??""};
  }
  return result;
};
document.querySelector("#account").addEventListener("pointermove",()=>{
  if(document.querySelector("#account")?.dataset.quotapinLayoutDragging!=="true") return;
  const frame={at:performance.now()};
  for(const id of labModules){
    const node=["value","dot","label","countdown","relative","seconds","date","reset"].includes(id)
      ? document.querySelector('#quotapin-inline-badge [data-part="'+id+'"]')
      : document.querySelector('#account [data-quotapin-module="'+id+'"]');
    if(!node||getComputedStyle(node).display==="none") continue;
    const rect=node.getBoundingClientRect(); frame[id]={left:rect.left,top:rect.top,width:rect.width,height:rect.height,center:rect.left+rect.width/2};
  }
  window.__layoutLabGeometry.push(frame);
  if(window.__layoutLabGeometry.length>120) window.__layoutLabGeometry.shift();
  document.querySelector("#account").dataset.labGeometry=JSON.stringify(window.__layoutLabGeometry);
});
function openLabEditor(attempt=0){
  window.__quotaPinController.openEditor();
  const editor=document.querySelector("#quotapin-profile-editor");
  if(!editor&&attempt<5){ setTimeout(()=>openLabEditor(attempt+1),100); return; }
  const mode=labParams.get("mode");
  if(mode){ document.querySelector('[data-editor-mode="'+mode+'"]')?.click(); }
}
if(labParams.get("panel")!=="0") setTimeout(()=>openLabEditor(),120);
</script></body></html>`;

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`).pathname;
  response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'");
  response.setHeader("Cache-Control", "no-store");
  if (pathname === "/renderer.js") {
    response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
    response.end(renderer);
    return;
  }
  if (pathname === "/account-avatar.png") {
    response.writeHead(200, { "Content-Type": "image/png", "Content-Length": accountAvatar.length });
    response.end(accountAvatar);
    return;
  }
  if (pathname === "/favicon.ico") {
    response.writeHead(204);
    response.end();
    return;
  }
  if (pathname === "/" || pathname === "/index.html") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(html);
    return;
  }
  response.writeHead(404).end();
});
server.listen(port, "127.0.0.1", () => console.log(`QuotaPin Layout Lab http://127.0.0.1:${port}`));
