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