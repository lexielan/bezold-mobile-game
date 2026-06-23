const socket=io();
let current=null;
const $=id=>document.getElementById(id);

$("createBtn").onclick=()=>{
  $("message").textContent="建立房間中...";
  socket.emit("createRoom",{name:$("nameInput").value||"玩家A"});
};

$("joinBtn").onclick=()=>{
  $("message").textContent="加入房間中...";
  socket.emit("joinRoom",{code:$("roomInput").value,name:$("nameInput").value||"玩家B"});
};

$("leaveBtn").onclick=()=>location.reload();
$("readyBtn").onclick=()=>socket.emit("playerReady",{code:current.room.code});
$("nextBtn").onclick=()=>socket.emit("nextRound",{code:current.room.code});
$("restartBtn").onclick=()=>socket.emit("restartRoom",{code:current.room.code});

socket.on("created",d=>{$("roomInput").value=d.code});
socket.on("errorMessage",m=>{$("message").textContent=m});
socket.on("state",s=>{current=s;render()});

function showScreen(id){
  document.querySelectorAll(".screen").forEach(s=>s.classList.remove("active"));
  $(id).classList.add("active");
}

function rgbCss(rgb){return`rgb(${rgb[0]},${rgb[1]},${rgb[2]})`}
function rgbText(rgb){return`RGB(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`}

function render(){
  showScreen("game");
  const room=current.room;

  $("roomCode").textContent=room.code;
  $("yourSlot").textContent=current.you?current.you.slot:"?";
  $("playersText").textContent="目前玩家："+room.players.map(p=>`${p.slot} ${p.name}`).join("、");

  $("waitingPanel").classList.toggle("hidden",room.phase!=="waiting");
  $("instructionPanel").classList.toggle("hidden",room.phase!=="instruction");
  $("countdownPanel").classList.toggle("hidden",room.phase!=="countdown");
  $("gamePanel").classList.toggle("hidden",room.phase==="waiting"||room.phase==="instruction"||room.phase==="countdown");

  if(room.phase==="instruction"){
    const ready=room.ready||{};
    $("readyStatus").textContent=`準備狀態：A ${ready.A?"完成":"未完成"} / B ${ready.B?"完成":"未完成"}`;
  }

  if(room.phase==="countdown"){
    $("countdownText").textContent=room.countdownLeft||3;
    return;
  }

  if(room.phase==="waiting"||room.phase==="instruction")return;

  $("roundText").textContent=`${room.round}/${room.maxRounds}`;
  $("timerText").textContent=room.timeLeft;
  $("scoreA").textContent=room.scores.A;
  $("scoreB").textContent=room.scores.B;
  $("messageBar").textContent=room.lastMessage||"";

  if(room.target){
    $("targetSwatch").style.background=rgbCss(room.target);
    $("targetText").textContent="請找出正確答案";
  }

  renderStatus(room);
  renderHand(room);
  renderReveal(room);
  renderEnd(room);
}

function renderStatus(room){
  if(room.phase==="selecting"){
    $("status").textContent=room.selections[current.you.slot]?"你已出牌，等待對方":"可先使用「功能牌」搗亂對方!";
  }else if(room.phase==="revealed"){
    $("status").textContent="揭示正確答案";
  }else if(room.phase==="ended"){
    $("status").textContent="遊戲結束";
  }
}

function renderHand(room){
  const box=$("hand");
  box.innerHTML="";
  const selected=room.selections[current.you.slot];

  current.hand.forEach(card=>{
    const el=createCard(card,false,false);

    if(room.phase!=="selecting"||selected){
      el.classList.add("disabled");
    }

    el.onclick=()=>{
      if(room.phase==="selecting"&&!selected){
        socket.emit("playCard",{code:room.code,cardId:card.id});
      }
    };

    box.appendChild(el);
  });
}

function createCard(card,revealed,isCorrectCard){
  const el=document.createElement("div");
  el.className="gameCard";
  if(isCorrectCard) el.classList.add("correct");

  if(card.type==="trick"){
    el.classList.add("trickCard");
    el.style.background="repeating-linear-gradient(90deg,#ffdf55 0 12px,#7b3cff 12px 24px)";
    el.innerHTML=`<div class="trickBadge">功能牌</div><div class="cardName">${card.name}</div>`;
    return el;
  }

  el.style.background=rgbCss(card.base);

  const circle=document.createElement("div");
  circle.className="circle";
  circle.style.background=rgbCss(card.center);

  const name=document.createElement("div");
  name.className="cardName";
  name.textContent="";

  el.appendChild(circle);

  if(!revealed){
    const stripes=document.createElement("div");
    stripes.className="stripes";
    stripes.style.background=stripeBg(card.stripe,card.stripeWidth||3,card.stripeGap||3);
    el.appendChild(stripes);
  }

  el.appendChild(name);
  return el;
}

function stripeBg(stripe,width,gap){
  const w=Number(width)||3;
  const g=Number(gap)||3;
  const period=w+g;
  return`repeating-linear-gradient(90deg,${rgbCss(stripe)} 0 ${w}px,transparent ${w}px ${period}px)`;
}

function renderReveal(room){
  $("revealPanel").classList.toggle("hidden",room.phase!=="revealed");
  if(room.phase!=="revealed")return;

  const r=room.results[room.results.length-1];

  $("resultText").innerHTML=`
    正確答案：<b>${r.correctCard ? rgbText(r.correctCard.center) : "無"}</b><br>
    玩家 A：${r.A ? `${rgbText(r.A.center)}｜RGB差距 ${r.A.distance.toFixed(1)}｜${r.A.isCorrect ? "答對" : "答錯"}` : "未出牌"}<br>
    玩家 B：${r.B ? `${rgbText(r.B.center)}｜RGB差距 ${r.B.distance.toFixed(1)}｜${r.B.isCorrect ? "答對" : "答錯"}` : "未出牌"}<br>
    <b>${r.resultText}</b>
  `;

  const box=$("revealCards");
  box.innerHTML="";

  const answerWrap=document.createElement("div");
  answerWrap.className="revealItem";
  answerWrap.innerHTML="<h3>正確答案</h3>";
  if(r.correctCard){
    answerWrap.appendChild(createCard({
      type:"normal",
      center:r.correctCard.center,
      base:[247,247,247],
      stripe:[0,0,0],
      stripeWidth:3,
      stripeGap:3,
      name:"正確答案"
    },true,true));
  }
  box.appendChild(answerWrap);

  ["A","B"].forEach(slot=>{
    const wrap=document.createElement("div");
    wrap.className="revealItem";
    wrap.innerHTML=`<h3>玩家 ${slot}</h3>`;

    const data=r[slot];

    if(data){
      wrap.appendChild(createCard({
        type:"normal",
        center:data.center,
        base:[247,247,247],
        stripe:[0,0,0],
        stripeWidth:3,
        stripeGap:3,
        name:"玩家選擇"
      },true,data.isCorrect));
    }else{
      const empty=document.createElement("div");
      empty.className="panel";
      empty.textContent="未出牌";
      wrap.appendChild(empty);
    }

    box.appendChild(wrap);
  });
}

function renderEnd(room){
  $("endPanel").classList.toggle("hidden",room.phase!=="ended");
  if(room.phase!=="ended")return;

  $("revealPanel").classList.add("hidden");
  $("winnerText").innerHTML=`<h3>贏家：${room.winner}</h3>`;
  $("researchText").innerHTML=buildResearch(room.results);
}

function buildResearch(results){
  const ds=[],corrects=[],times=[];

  results.forEach(r=>{
    ["A","B"].forEach(slot=>{
      const d=r[slot];
      if(!d)return;
      if(d.distance!=null) ds.push(d.distance);
      corrects.push(d.isCorrect?1:0);
      if(d.selectedSecondsLeft!=null) times.push(60-d.selectedSecondsLeft);
    });
  });

  const avg=a=>a.length?(a.reduce((x,y)=>x+y,0)/a.length).toFixed(1):"無資料";
  const rate=a=>a.length?((a.reduce((x,y)=>x+y,0)/a.length)*100).toFixed(1)+"%":"無資料";

  return `<table class="dataTable">
    <tr><th>研究指標</th><th>結果</th></tr>
    <tr><td>平均 RGB 誤差距離</td><td>${avg(ds)}</td></tr>
    <tr><td>正確率</td><td>${rate(corrects)}</td></tr>
    <tr><td>平均花費秒數</td><td>${avg(times)}</td></tr>
  </table>`;
}

setInterval(()=>{
  if(current?.room?.phase==="selecting"){
    $("timerText").textContent=Math.max(0,Number($("timerText").textContent)-1);
  }
},1000);
