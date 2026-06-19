
const socket = io();
let current = null;

const $ = id => document.getElementById(id);

$("createBtn").onclick = () => {
  $("message").textContent = "建立房間中...";
  socket.emit("createRoom", { name: $("nameInput").value || "玩家A" });
};

$("joinBtn").onclick = () => {
  $("message").textContent = "加入房間中...";
  socket.emit("joinRoom", {
    code: $("roomInput").value,
    name: $("nameInput").value || "玩家B"
  });
};

$("leaveBtn").onclick = () => location.reload();

$("nextBtn").onclick = () => {
  socket.emit("nextRound", { code: current.room.code });
};

$("restartBtn").onclick = () => {
  socket.emit("restartRoom", { code: current.room.code });
};

$("downloadCsvBtn").onclick = () => downloadCSV();

socket.on("created", data => {
  $("roomInput").value = data.code;
});

socket.on("errorMessage", msg => {
  $("message").textContent = msg;
});

socket.on("state", state => {
  current = state;
  render();
});

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  $(id).classList.add("active");
}

function rgbCss(rgb) {
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

function rgbText(rgb) {
  return "";
}

function render() {
  showScreen("game");

  const room = current.room;

  $("roomCode").textContent = room.code;
  $("yourSlot").textContent = current.you ? current.you.slot : "?";
  $("playersText").textContent = "目前玩家：" + room.players.map(p => `${p.slot} ${p.name}`).join("、");

  $("waitingPanel").classList.toggle("hidden", room.phase !== "waiting");
  $("gamePanel").classList.toggle("hidden", room.phase === "waiting");

  if (room.phase === "waiting") return;

  $("roundText").textContent = `${room.round}/${room.maxRounds}`;
  $("timerText").textContent = room.timeLeft;
  $("scoreA").textContent = room.scores.A;
  $("scoreB").textContent = room.scores.B;
  $("messageBar").textContent = room.lastMessage || "";

  if (room.target) {
    $("targetSwatch").style.background = rgbCss(room.target);
    $("targetText").textContent = "請選擇最接近的顏色";
  }

  renderStatus(room);
  renderHand(room);
  renderReveal(room);
  renderEnd(room);
}

function renderStatus(room) {
  if (room.phase === "selecting") {
    const selected = room.selections[current.you.slot];
    $("status").textContent = selected ? "你已出牌，等待對方" : "請選一張顏色牌，或先使用搗亂牌";
  } else if (room.phase === "revealed") {
    $("status").textContent = "已揭示真實中心色";
  } else if (room.phase === "ended") {
    $("status").textContent = "遊戲結束";
  }
}

function renderHand(room) {
  const handBox = $("hand");
  handBox.innerHTML = "";

  const selected = room.selections[current.you.slot];

  current.hand.forEach(card => {
    const el = createCard(card, false);

    if (room.phase !== "selecting" || selected) {
      el.classList.add("disabled");
    }

    el.onclick = () => {
      if (room.phase === "selecting" && !selected) {
        socket.emit("playCard", { code: room.code, cardId: card.id });
      }
    };

    handBox.appendChild(el);
  });
}

function createCard(card, revealed) {
  const el = document.createElement("div");
  el.className = "gameCard";

  if (card.type === "trick") {
    el.style.background = trickBackground(card.effect);
    el.innerHTML = `<div class="trickBadge">搗亂</div><div class="cardName">${card.name}</div>`;
    return el;
  }

  el.style.background = rgbCss(card.base);

  const circle = document.createElement("div");
  circle.className = "circle";
  circle.style.background = rgbCss(card.center);

  const name = document.createElement("div");
  name.className = "cardName";
  name.textContent = "";

 // const tag = document.createElement("div");
 // tag.className = "rgbTag";
  //tag.textContent = card.center.join(",");

  el.appendChild(circle);

  if (!revealed) {
    const stripes = document.createElement("div");
    stripes.className = "stripes";
    stripes.style.background = stripeBg(card.stripe, card.lineMode);
    el.appendChild(stripes);
  }

 // el.appendChild(tag);
  el.appendChild(name);
  return el;
}

function trickBackground(effect) {
  if (effect === "reverse") {
    return "repeating-linear-gradient(90deg,#ffdf55 0 12px,#7b3cff 12px 24px)";
  }
  if (effect === "thin") {
    return "repeating-linear-gradient(90deg,#45e3ff 0 6px,#172247 6px 12px)";
  }
  return "repeating-linear-gradient(90deg,#ff714d 0 12px,#111 12px 24px)";
}

function stripeBg(stripe, lineMode) {
  const width = lineMode === "thin" ? 6 : 12;
  const gap = lineMode === "thin" ? 14 : 24;
  return `repeating-linear-gradient(90deg, ${rgbCss(stripe)} 0 ${width}px, transparent ${width}px ${gap}px)`;
}

function renderReveal(room) {
  $("revealPanel").classList.toggle("hidden", room.phase !== "revealed");
  if (room.phase !== "revealed") return;

  const result = room.results[room.results.length - 1];

  $("resultText").innerHTML = `
    目標：${rgbText(result.target)}<br>
    玩家 A：${result.A ? rgbText(result.A.center) + "，距離 " + result.A.distance.toFixed(1) : "未出牌"}<br>
    玩家 B：${result.B ? rgbText(result.B.center) + "，距離 " + result.B.distance.toFixed(1) : "未出牌"}<br>
    <b>${result.resultText}</b>
  `;

  const box = $("revealCards");
  box.innerHTML = "";

  ["A", "B"].forEach(slot => {
    const wrap = document.createElement("div");
    wrap.innerHTML = `<h3>玩家 ${slot}</h3>`;
    const data = result[slot];

    if (data) {
      wrap.appendChild(createCard({
        type: "normal",
        center: data.center,
        base: [247,247,247],
        stripe: [0,0,0],
        name: rgbText(data.center)
      }, true));
    } else {
      const empty = document.createElement("div");
      empty.className = "panel";
      empty.textContent = "未出牌";
      wrap.appendChild(empty);
    }

    box.appendChild(wrap);
  });
}

function renderEnd(room) {
  $("endPanel").classList.toggle("hidden", room.phase !== "ended");
  if (room.phase !== "ended") return;

  $("revealPanel").classList.add("hidden");
  $("winnerText").innerHTML = `<h3>贏家：${room.winner}</h3>`;
  $("researchText").innerHTML = buildResearch(room.results);
}

function buildResearch(results) {
  const distances = [];
  const trickDistances = [];
  const normalDistances = [];

  results.forEach(r => {
    ["A", "B"].forEach(slot => {
      const data = r[slot];
      if (!data || data.distance == null) return;

      distances.push(data.distance);

      if (data.usedTricks && data.usedTricks.length > 0) {
        trickDistances.push(data.distance);
      } else {
        normalDistances.push(data.distance);
      }
    });
  });

  const avg = arr => arr.length ? (arr.reduce((a,b)=>a+b,0) / arr.length).toFixed(1) : "無資料";

  return `
    <table class="dataTable">
      <tr><th>研究指標</th><th>結果</th></tr>
      <tr><td>整體平均 RGB 誤差</td><td>${avg(distances)}</td></tr>
      <tr><td>使用搗亂牌者平均誤差</td><td>${avg(trickDistances)}</td></tr>
      <tr><td>未使用搗亂牌者平均誤差</td><td>${avg(normalDistances)}</td></tr>
    </table>
    <p>可作為小論研究：背景線條與色彩配置會影響玩家對中心色的判斷，形成色彩同化與知覺偏差。</p>
  `;
}

function downloadCSV() {
  const rows = [["round","target","player","center","distance","usedTricks","secondsLeft","winner"]];

  current.room.results.forEach(r => {
    ["A","B"].forEach(slot => {
      const data = r[slot];
      rows.push([
        r.round,
        r.target.join("-"),
        slot,
        data ? data.center.join("-") : "",
        data && data.distance != null ? data.distance.toFixed(3) : "",
        data && data.usedTricks ? data.usedTricks.join("|") : "",
        data && data.selectedSecondsLeft != null ? data.selectedSecondsLeft : "",
        r.winner || ""
      ]);
    });
  });

  const csv = rows.map(row => row.map(x => `"${String(x).replaceAll('"','""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `bezold_results_${current.room.code}.csv`;
  a.click();
}

setInterval(() => {
  if (current?.room?.phase === "selecting") {
    $("timerText").textContent = Math.max(0, Number($("timerText").textContent) - 1);
  }
}, 1000);
