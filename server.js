const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);

app.use(express.static("public"));

const rooms = {};
const MAX_ROUNDS = 5;
const ROUND_SECONDS = 60;
const COUNTDOWN_SECONDS = 3;
const GOOGLE_SHEET_WEBHOOK = process.env.GOOGLE_SHEET_WEBHOOK || "";

// 6 個候選圓：每回合 5 張普通牌 + 1 張功能牌。
// 5 張普通牌中一定有 1 張正確答案，另外 4 張由其他 5 個圓隨機抽，且不重複。
const colorPool = [
  { name:"橘紅", hex:"#FF6400", center:[255,100,0] },
  { name:"純紅", hex:"#FF0000", center:[255,0,0] },
  { name:"焦橘", hex:"#D66400", center:[214,100,0] },
  { name:"深紅", hex:"#C80000", center:[200,0,0] },
  { name:"亮橘", hex:"#FF7D00", center:[255,155,0] },
  { name:"珊瑚紅", hex:"#FF4040", center:[255,64,64] }
];

// 底色與線條色只從這三組搭配中抽。
// 每張普通牌會隨機使用其中一組，功能牌會交換對方普通牌的 base / stripe。
const visualPairs = [
  { name:"紫綠組", base:[176,32,255], stripe:[127,255,0] },     // #B020FF / #7FFF00
  { name:"藍黃組", base:[0,0,255], stripe:[255,255,0] },        // #0000FF / #FFFF00
  { name:"青粉組", base:[100,220,255], stripe:[255,170,140] }   // #64DCFF / #FFAA8C
];

function clone(x){ return JSON.parse(JSON.stringify(x)); }
function makeId(){ return Math.random().toString(36).slice(2, 10); }

function makeCode(){
  let result = "";
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let i = 0; i < 4; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

function shuffle(arr){ return arr.sort(() => Math.random() - 0.5); }

function rgbDistance(a, b){
  return Math.sqrt(
    Math.pow(a[0] - b[0], 2) +
    Math.pow(a[1] - b[1], 2) +
    Math.pow(a[2] - b[2], 2)
  );
}

function rgbString(rgb){
  return rgb ? rgb.join(",") : "";
}

function makeRoundHand(){
  const pool = shuffle(clone(colorPool));

  const correctSource = pool[0];
  const distractors = shuffle(pool.slice(1)).slice(0, 4);

  const selectedColors = shuffle([correctSource, ...distractors]);
  const shuffledVisualPairs = shuffle(clone(visualPairs));

  const normalCards = selectedColors.map((card, index) => {
    const pair = shuffledVisualPairs[index % shuffledVisualPairs.length];

    return {
      ...card,
      id: makeId(),
      type: "normal",
      base: pair.base,
      stripe: pair.stripe,
      visualPair: pair.name,
      stripeWidth: 3,
      stripeGap: 3,
      circleDiameter: 260,
      lineMode: "custom",
      trickEffect: null
    };
  });

  const correctCard = normalCards.find(card =>
    card.center[0] === correctSource.center[0] &&
    card.center[1] === correctSource.center[1] &&
    card.center[2] === correctSource.center[2]
  );

  const trickCard = {
    id: makeId(),
    type: "trick",
    effect: "swap",
    name: "底色線條交換"
  };

  return {
    handTemplate: [...normalCards, trickCard],
    correctCard: clone(correctCard)
  };
}

function publicRoom(room){
  const canRevealAnswer = room.phase === "revealed" || room.phase === "ended";
  return {
    code: room.code,
    phase: room.phase,
    round: room.round,
    maxRounds: MAX_ROUNDS,
    roundSeconds: ROUND_SECONDS,
    countdownLeft: room.countdownLeft,
    target: room.target,
    scores: room.scores,
    ready: room.ready,
    players: room.players.map(p => ({
      id: p.id,
      slot: p.slot,
      name: p.name,
      connected: p.connected
    })),
    selections: {
      A: !!room.selections.A,
      B: !!room.selections.B
    },
    timeLeft: room.endsAt ? Math.max(0, Math.ceil((room.endsAt - Date.now()) / 1000)) : ROUND_SECONDS,
    results: room.results,
    winner: room.winner,
    lastMessage: room.lastMessage,
    savedToBackend: room.savedToBackend || false,
    correctCard: canRevealAnswer ? room.correctCard : null
  };
}

function privateState(room, socketId){
  const player = room.players.find(p => p.id === socketId);
  return {
    you: player ? { slot: player.slot, name: player.name } : null,
    hand: player ? player.hand : [],
    room: publicRoom(room)
  };
}

function emitRoom(room){
  room.players.forEach(p => io.to(p.id).emit("state", privateState(room, p.id)));
}

function enterInstruction(room){
  room.phase = "instruction";
  room.ready = { A: false, B: false };
  room.lastMessage = "請先閱讀遊戲規則，雙方都按下「我知道了」後開始。";
  emitRoom(room);
}

function startCountdown(room){
  if (room.countdownTimer) clearInterval(room.countdownTimer);

  room.phase = "countdown";
  room.countdownLeft = COUNTDOWN_SECONDS;
  room.lastMessage = "雙方已準備，遊戲即將開始。";
  emitRoom(room);

  room.countdownTimer = setInterval(() => {
    room.countdownLeft -= 1;
    if (room.countdownLeft <= 0) {
      clearInterval(room.countdownTimer);
      room.countdownTimer = null;
      startGame(room);
    } else {
      emitRoom(room);
    }
  }, 1000);
}

function startGame(room){
  room.round = 1;
  room.scores = { A: 0, B: 0 };
  room.results = [];
  room.winner = null;
  room.savedToBackend = false;
  room.lastMessage = "遊戲開始！";
  startRound(room);
}

function startRound(room){
  if (room.timer) clearTimeout(room.timer);

  room.phase = "selecting";
  room.selections = { A: null, B: null };
  room.endsAt = Date.now() + ROUND_SECONDS * 1000;
  room.lastMessage = `第 ${room.round} 回合開始`;

  const roundData = makeRoundHand();
  room.correctCardId = roundData.correctCard.id;
  room.correctCard = roundData.correctCard;
  room.target = roundData.correctCard.center;

  room.players.forEach(p => {
    p.hand = clone(roundData.handTemplate);
    p.usedTricks = [];
    p.selectedSecondsLeft = null;
  });

  room.timer = setTimeout(() => revealRound(room, true), ROUND_SECONDS * 1000);
  emitRoom(room);
}

function revealRound(room, timeout = false){
  if (!room || room.phase !== "selecting") return;

  if (room.timer) clearTimeout(room.timer);
  room.phase = "revealed";

  const cardA = room.selections.A;
  const cardB = room.selections.B;

  const distA = cardA ? rgbDistance(room.target, cardA.center) : null;
  const distB = cardB ? rgbDistance(room.target, cardB.center) : null;

  const pA = room.players.find(p => p.slot === "A");
  const pB = room.players.find(p => p.slot === "B");

  const isCorrectA = !!(cardA && cardA.id === room.correctCardId);
  const isCorrectB = !!(cardB && cardB.id === room.correctCardId);

  let winner = null;
  let resultText = "";

  if (cardA && cardB) {
    if (isCorrectA && isCorrectB) {
      const timeA = pA ? pA.selectedSecondsLeft : -1;
      const timeB = pB ? pB.selectedSecondsLeft : -1;

      if (timeA > timeB) {
        room.scores.A += 1;
        winner = "A";
        resultText = "雙方都選到正確答案，玩家 A 較早出牌，因此玩家 A 得分";
      } else if (timeB > timeA) {
        room.scores.B += 1;
        winner = "B";
        resultText = "雙方都選到正確答案，玩家 B 較早出牌，因此玩家 B 得分";
      } else {
        resultText = "雙方都選到正確答案，本回合平手";
      }
    } else if (isCorrectA && !isCorrectB) {
      room.scores.A += 1;
      winner = "A";
      resultText = "玩家 A 選到正確答案，玩家 A 得分";
    } else if (!isCorrectA && isCorrectB) {
      room.scores.B += 1;
      winner = "B";
      resultText = "玩家 B 選到正確答案，玩家 B 得分";
    } else {
      resultText = "雙方都沒有選到正確答案，本回合無人得分";
    }
  } else if (cardA && !cardB) {
    if (isCorrectA) {
      room.scores.A += 1;
      winner = "A";
      resultText = "玩家 B 未出牌，玩家 A 選到正確答案，因此玩家 A 得分";
    } else {
      resultText = "玩家 B 未出牌，但玩家 A 未選到正確答案，本回合無人得分";
    }
  } else if (!cardA && cardB) {
    if (isCorrectB) {
      room.scores.B += 1;
      winner = "B";
      resultText = "玩家 A 未出牌，玩家 B 選到正確答案，因此玩家 B 得分";
    } else {
      resultText = "玩家 A 未出牌，但玩家 B 未選到正確答案，本回合無人得分";
    }
  } else {
    resultText = "雙方皆未出牌，本回合無人得分";
  }

  room.results.push({
    round: room.round,
    target: room.target,
    correctCard: room.correctCard,
    A: cardA ? {
      center: cardA.center,
      base: cardA.base,
      stripe: cardA.stripe,
      visualPair: cardA.visualPair,
      stripeWidth: cardA.stripeWidth,
      stripeGap: cardA.stripeGap,
      circleDiameter: cardA.circleDiameter,
      distance: distA,
      isCorrect: isCorrectA,
      usedTricks: pA ? pA.usedTricks : [],
      selectedSecondsLeft: pA ? pA.selectedSecondsLeft : null
    } : null,
    B: cardB ? {
      center: cardB.center,
      base: cardB.base,
      stripe: cardB.stripe,
      visualPair: cardB.visualPair,
      stripeWidth: cardB.stripeWidth,
      stripeGap: cardB.stripeGap,
      circleDiameter: cardB.circleDiameter,
      distance: distB,
      isCorrect: isCorrectB,
      usedTricks: pB ? pB.usedTricks : [],
      selectedSecondsLeft: pB ? pB.selectedSecondsLeft : null
    } : null,
    winner,
    resultText,
    timeout
  });

  room.lastMessage = resultText;

  if (room.round >= MAX_ROUNDS) endGame(room);
  emitRoom(room);
}

async function saveRoomToGoogleSheet(room){
  if (!GOOGLE_SHEET_WEBHOOK) {
    console.log("GOOGLE_SHEET_WEBHOOK is not set. Skip saving.");
    return;
  }

  if (room.savedToBackend) return;
  room.savedToBackend = true;

  const players = {};
  room.players.forEach(p => players[p.slot] = p.name);

  const rows = [];
  const createdAt = new Date().toISOString();

  room.results.forEach(result => {
    ["A", "B"].forEach(slot => {
      const data = result[slot];

      rows.push({
        createdAt,
        roomCode: room.code,
        finalWinner: room.winner || "",
        finalScoreA: room.scores.A,
        finalScoreB: room.scores.B,
        round: result.round,
        playerSlot: slot,
        playerName: players[slot] || "",
        targetRGB: rgbString(result.target),
        correctRGB: result.correctCard ? rgbString(result.correctCard.center) : "",
        selectedRGB: data ? rgbString(data.center) : "",
        cardBaseRGB: data ? rgbString(data.base) : "",
        cardStripeRGB: data ? rgbString(data.stripe) : "",
        visualPair: data ? data.visualPair : "",
        stripeWidth: data ? data.stripeWidth : "",
        stripeGap: data ? data.stripeGap : "",
        circleDiameter: data ? data.circleDiameter : "",
        distance: data && data.distance != null ? Number(data.distance.toFixed(3)) : "",
        isCorrect: data ? (data.isCorrect ? "TRUE" : "FALSE") : "",
        usedTricks: data && data.usedTricks ? data.usedTricks.join("|") : "",
        selectedSecondsLeft: data && data.selectedSecondsLeft != null ? data.selectedSecondsLeft : "",
        spentSeconds: data && data.selectedSecondsLeft != null ? ROUND_SECONDS - data.selectedSecondsLeft : "",
        roundWinner: result.winner || "",
        roundText: result.resultText || "",
        timeout: result.timeout ? "TRUE" : "FALSE"
      });
    });
  });

  try {
    const res = await fetch(GOOGLE_SHEET_WEBHOOK, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({rows})
    });
    console.log("Google Sheet save status:", res.status);
  } catch (err) {
    room.savedToBackend = false;
    console.error("Google Sheet save failed:", err);
  }
}

function endGame(room){
  room.phase = "ended";
  room.winner = room.scores.A === room.scores.B ? "平手" : (room.scores.A > room.scores.B ? "玩家 A" : "玩家 B");
  saveRoomToGoogleSheet(room);
}

function applyTrick(room, player, effect){
  const opponent = room.players.find(p => p.slot !== player.slot);
  if (!opponent) return;

  player.usedTricks.push("底色線條交換");

  opponent.hand.forEach(card => {
    if (card.type !== "normal") return;
    const temp = card.base;
    card.base = card.stripe;
    card.stripe = temp;
    card.trickEffect = "swap";
  });

  room.lastMessage = `玩家 ${player.slot} 使用功能牌：底色線條交換`;
}

io.on("connection", socket => {
  socket.on("createRoom", data => {
    let roomCode = makeCode();
    while (rooms[roomCode]) roomCode = makeCode();

    const room = {
      code: roomCode,
      phase: "waiting",
      round: 0,
      target: null,
      correctCardId: null,
      correctCard: null,
      scores: { A: 0, B: 0 },
      ready: { A: false, B: false },
      selections: { A: null, B: null },
      players: [{
        id: socket.id,
        name: data && data.name ? data.name : "玩家A",
        slot: "A",
        connected: true,
        hand: [],
        usedTricks: [],
        selectedSecondsLeft: null
      }],
      results: [],
      winner: null,
      timer: null,
      countdownTimer: null,
      countdownLeft: COUNTDOWN_SECONDS,
      endsAt: null,
      lastMessage: "等待第二位玩家加入",
      savedToBackend: false
    };

    rooms[roomCode] = room;
    socket.join(roomCode);
    socket.emit("created", { code: roomCode });
    emitRoom(room);
  });

  socket.on("joinRoom", data => {
    const roomCode = String(data && data.code ? data.code : "").trim().toUpperCase();
    const room = rooms[roomCode];

    if (!room) return socket.emit("errorMessage", "找不到房間");
    if (room.players.length >= 2) return socket.emit("errorMessage", "房間已滿");

    room.players.push({
      id: socket.id,
      name: data && data.name ? data.name : "玩家B",
      slot: "B",
      connected: true,
      hand: [],
      usedTricks: [],
      selectedSecondsLeft: null
    });

    socket.join(roomCode);
    enterInstruction(room);
  });

  socket.on("playerReady", data => {
    const roomCode = String(data && data.code ? data.code : "").trim().toUpperCase();
    const room = rooms[roomCode];
    if (!room || room.phase !== "instruction") return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    room.ready[player.slot] = true;
    room.lastMessage = `玩家 ${player.slot} 已閱讀規則`;

    if (room.ready.A && room.ready.B) startCountdown(room);
    else emitRoom(room);
  });

  socket.on("playCard", data => {
    const roomCode = String(data && data.code ? data.code : "").trim().toUpperCase();
    const room = rooms[roomCode];
    if (!room || room.phase !== "selecting") return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    if (room.selections[player.slot]) return;

    const card = player.hand.find(c => c.id === data.cardId);
    if (!card) return;

    if (card.type === "trick") {
      applyTrick(room, player, card.effect);
      player.hand = player.hand.filter(c => c.id !== card.id);
      emitRoom(room);
      return;
    }

    room.selections[player.slot] = card;
    player.selectedSecondsLeft = Math.max(0, Math.ceil((room.endsAt - Date.now()) / 1000));
    player.hand = player.hand.filter(c => c.id !== card.id);

    if (room.selections.A && room.selections.B) revealRound(room, false);
    else emitRoom(room);
  });

  socket.on("nextRound", data => {
    const roomCode = String(data && data.code ? data.code : "").trim().toUpperCase();
    const room = rooms[roomCode];
    if (!room || room.phase !== "revealed") return;
    room.round += 1;
    startRound(room);
  });

  socket.on("restartRoom", data => {
    const roomCode = String(data && data.code ? data.code : "").trim().toUpperCase();
    const room = rooms[roomCode];
    if (!room || room.players.length < 2) return;
    enterInstruction(room);
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log("server running on", PORT));
