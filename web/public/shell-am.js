(function(){
  "use strict";
  var LOG_KEY="ql_bot_logs_v1",LOG_MAX=8,logPage=0;
  function $(id){return document.getElementById(id)}
  function loadLogs(){try{return JSON.parse(localStorage.getItem(LOG_KEY)||"[]")}catch(e){return[]}}
  function saveLogs(a){localStorage.setItem(LOG_KEY,JSON.stringify(a.slice(0,LOG_MAX)))}
  function renderLogs(){
    var list=$("am-logs-list"),pageEl=$("am-logs-page");if(!list)return;
    var arr=loadLogs(),pages=Math.max(1,Math.ceil(arr.length/LOG_MAX)||1);
    if(logPage>=pages)logPage=pages-1;if(logPage<0)logPage=0;
    var slice=arr.slice(logPage*LOG_MAX,logPage*LOG_MAX+LOG_MAX);
    list.replaceChildren();
    if(!slice.length){var e=document.createElement("div");e.className="am-logs-empty";e.textContent="No logs yet";list.appendChild(e)}
    else{slice.forEach(function(row){var el=document.createElement("div");el.className="am-logs-item";
      var t=document.createElement("div");t.className="t";t.textContent=new Date(row.t).toLocaleString();
      var m=document.createElement("div");m.className="m";m.textContent=row.m;el.appendChild(t);el.appendChild(m);list.appendChild(el)})}
    if(pageEl)pageEl.textContent=(logPage+1)+" / "+pages;
    var bell=$("am-bell");if(bell)bell.classList.toggle("has-alert",arr.length>0);
  }
  function setVal(id,text,on){var el=$(id);if(!el)return;el.textContent=text;el.classList.toggle("is-on",!!on)}
  function paintShellStatus(){
    var me=window.state&&window.state.me,ov=window.state&&window.state.overview;
    if(me){var av=$("sidebar-avatar");if(av&&me.avatar)av.src=me.avatar;
      var un=$("sidebar-username");if(un)un.textContent=me.username||me.tag||"User";
      var badge=$("sidebar-role-badge");if(badge)badge.hidden=!me.owner}
    var sys=(ov&&(ov.systems||ov.status||ov.bot))||{};
    var calOn=!!(sys.econCal||sys.econ_calendar||(ov&&ov.econCal&&ov.econCal.enabled));
    var newsOn=!!(sys.newsfeed||sys.newsFeed||(ov&&ov.newsfeed&&ov.newsfeed.enabled));
    var lvlOn=!!(sys.leveling||(ov&&ov.leveling&&ov.leveling.enabled!==false));
    var whopOn=!!(sys.whop||(ov&&ov.whop&&ov.whop.enabled));
    try{var ft=(ov&&ov.features)||(window.state&&window.state.features)||{};
      if(ft.econ_calendar!=null)calOn=!!ft.econ_calendar;
      if(ft.newsfeed!=null)newsOn=!!ft.newsfeed;
      if(ft.leveling!=null)lvlOn=!!ft.leveling}catch(e){}
    setVal("st-calendar",calOn?"On":"Off",calOn);
    setVal("st-newsfeed",newsOn?"On":"Off",newsOn);
    setVal("st-leveling",lvlOn?"On":"Off",lvlOn);
    setVal("st-whop",whopOn?"On":"Off",whopOn);
  }
  document.addEventListener("DOMContentLoaded",function(){
    var bell=$("am-bell"),logs=$("am-logs");
    if(bell&&logs){
      bell.addEventListener("click",function(e){e.stopPropagation();var open=logs.classList.toggle("is-open");bell.setAttribute("aria-expanded",open?"true":"false");if(open)renderLogs()});
      document.addEventListener("click",function(e){if(!logs.contains(e.target)&&e.target!==bell&&!bell.contains(e.target)){logs.classList.remove("is-open");bell.setAttribute("aria-expanded","false")}})}
    var clearBtn=$("am-logs-clear");if(clearBtn)clearBtn.addEventListener("click",function(){saveLogs([]);logPage=0;renderLogs()});
    var prev=$("am-logs-prev"),next=$("am-logs-next");
    if(prev)prev.addEventListener("click",function(){logPage--;renderLogs()});
    if(next)next.addEventListener("click",function(){logPage++;renderLogs()});
    var user=$("sidebar-user"),menu=$("sidebar-user-menu");
    if(user&&menu){user.addEventListener("click",function(e){if(e.target.closest("a"))return;menu.classList.toggle("is-open")});
      document.addEventListener("click",function(e){if(!user.contains(e.target))menu.classList.remove("is-open")})}
    setInterval(paintShellStatus,2500);paintShellStatus();renderLogs();
  });
  window.__paintShellStatus=paintShellStatus;
})();

;(function () {
  function closeNav() {
    var s = document.querySelector(".app-shell");
    var b = document.getElementById("am-menu-btn");
    var c = document.getElementById("am-nav-scrim");
    if (s) s.classList.remove("nav-open");
    if (b) b.setAttribute("aria-expanded", "false");
    if (c) c.hidden = true;
  }
  function openNav() {
    var s = document.querySelector(".app-shell");
    var b = document.getElementById("am-menu-btn");
    var c = document.getElementById("am-nav-scrim");
    if (s) s.classList.add("nav-open");
    if (b) b.setAttribute("aria-expanded", "true");
    if (c) c.hidden = false;
  }
  document.addEventListener("DOMContentLoaded", function () {
    var b = document.getElementById("am-menu-btn");
    var c = document.getElementById("am-nav-scrim");
    if (b) b.addEventListener("click", function (e) {
      e.stopPropagation();
      var s = document.querySelector(".app-shell");
      if (s && s.classList.contains("nav-open")) closeNav(); else openNav();
    });
    if (c) c.addEventListener("click", closeNav);
    document.querySelectorAll("#sections button[data-goto]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (window.matchMedia("(max-width: 900px)").matches) closeNav();
      });
    });
  });
})();
