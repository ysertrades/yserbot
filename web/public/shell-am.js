(function(){"use strict";
function $(id){return document.getElementById(id)}
function fmtUptime(ms){if(!ms||ms<0)return"—";var s=Math.floor(ms/1000),d=Math.floor(s/86400),h=Math.floor((s%86400)/3600);if(d>0)return d+"d "+h+"h";var m=Math.floor((s%3600)/60);return h>0?h+"h "+m+"m":m+"m"}
function setVal(id,text,on){var el=$(id);if(!el)return;el.textContent=text;el.classList.toggle("is-on",!!on)}
function paintShellStatus(){var me=window.state&&window.state.me,ov=window.state&&window.state.overview,g=window.state&&window.state.guild;
if(me){var av=$("sidebar-avatar");if(av&&me.avatar)av.src=me.avatar;var un=$("sidebar-username");if(un)un.textContent=me.username||me.tag||"User";var badge=$("sidebar-role-badge");if(badge)badge.hidden=!me.owner}
var open=$("open-server");if(open&&g&&g.id){open.href="https://discord.com/channels/"+g.id}
var nGuilds=(me&&me.guilds&&me.guilds.length)||0;setVal("st-servers",nGuilds?String(nGuilds):"—");
var sys=(ov&&(ov.systems||ov.status||ov.bot))||{};
var calOn=!!(sys.econCal||sys.econ_calendar||(ov&&ov.econCal&&ov.econCal.enabled));
var whopOn=!!(sys.whop||(ov&&ov.whop&&ov.whop.enabled));
setVal("st-calendar",calOn?"Running":"Off",calOn);setVal("st-whop",whopOn?"On":"Off",whopOn);
var ping=sys.ping??sys.gatewayPing??(ov&&ov.ping);if(ping!=null)setVal("st-ping",Math.round(Number(ping))+" ms");
var up=sys.uptimeMs??sys.uptime??(ov&&ov.uptimeMs);if(up!=null)setVal("st-uptime",fmtUptime(Number(up)));
var bell=$("am-bell");if(bell){var modOpen=(ov&&(ov.modCases||ov.moderationOpen))||0;bell.classList.toggle("has-alert",Number(modOpen)>0||!calOn)}
function setMeta(goto,text,isDot){var btn=document.querySelector('#sections button[data-goto="'+goto+'"]');if(!btn)return;var slot=btn.querySelector(".nav-meta, .nav-dot");if(slot)slot.remove();if(!text&&!isDot)return;if(isDot){var d=document.createElement("span");d.className="nav-dot";btn.appendChild(d)}else{var m=document.createElement("span");m.className="nav-meta";m.textContent=text;btn.appendChild(m)}}
try{var tpls=ov&&ov.composer&&ov.composer.length;if(tpls)setMeta("composer",String(tpls));
var gw=ov&&(ov.activeGiveaways??ov.giveawaysActive);if(gw)setMeta("giveaways",String(gw));
var tk=ov&&(ov.openTickets??ov.ticketsOpen);if(tk)setMeta("tickets",String(tk));
var mc=ov&&(ov.modCases??ov.moderationOpen);if(mc)setMeta("moderation",String(mc));
var fd=ov&&(ov.activeFeeds??ov.feedsActive);if(fd)setMeta("feeds",String(fd));
if(calOn)setMeta("automation",null,true)}catch(_){}}
document.addEventListener("keydown",function(e){if((e.ctrlKey||e.metaKey)&&(e.key==="k"||e.key==="K")){var inp=$("am-search-input");if(inp){e.preventDefault();inp.focus()}}});
document.addEventListener("DOMContentLoaded",function(){var inp=$("am-search-input");if(inp)inp.addEventListener("keydown",function(e){if(e.key!=="Enter")return;var q=(inp.value||"").trim().toLowerCase();if(!q)return;document.querySelectorAll("#sections button[data-goto]").forEach(function(b){if(b.hidden)return;var label=((b.querySelector(".nav-label")||b).textContent||"").toLowerCase();if(label.indexOf(q)>=0){b.click();inp.blur()}})});
var user=$("sidebar-user"),menu=$("sidebar-user-menu");if(user&&menu){user.addEventListener("click",function(e){if(e.target.closest("a"))return;menu.classList.toggle("is-open")});document.addEventListener("click",function(e){if(!user.contains(e.target))menu.classList.remove("is-open")})}
setInterval(paintShellStatus,2000);paintShellStatus()});
window.__paintShellStatus=paintShellStatus})();
