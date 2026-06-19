
const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);

app.use(express.static("public"));

const rooms = {};
const MAX_ROUNDS = 5;
const ROUND_SECONDS = 60;

const targetPool = [
  [255, 0, 0],
  [180, 0, 0],
  [255, 0, 130],
  [255, 70, 0],
  [240, 40, 40],
  [210, 20, 80]
];

const cardPool = [
  { name:"赤紅", center:[255,0,0], base:[255,220,60], stripe:[30,20,20] },
  { name:"深紅", center:[180,0,0], base:[80,210,150], stripe:[30,20,20] },
  { name:"洋紅", center:[255,0,130], base:[90,210,150], stripe:[30,20,20] },
  { name:"橘紅", center:[255,70,0], base:[80,130,230], stripe:[30,20,20] },
  { name:"亮紅", center:[240,40,40], base:[80,210,230], stripe:[30,20,20] },
  { name:"酒紅", center:[210,20,80], base:[255,210,80], stripe:[30,20,20] },
  { name:"暗莓紅", center:[150,0,40], base:[90,210,160], stripe:[30,20,20] },
  { name:"暖橘紅", center:[255,100,30], base:[70,130,230], stripe:[30,20,20] },
  { name:"偏粉紅", center:[255,35,110], base:[40,190,220], stripe:[30,20,20] },
  { name:"焦糖紅", center:[220,60,20], base:[255,225,40], stripe:[30,20,20] }
];

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

function pick(arr) {
  return clone(arr[Math.floor(Math.random() * arr.length)]);
}

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

function makeCode() {
  let result = "";
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let i = 0; i < 4; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function shuffle(arr) {
  return arr.sort(() => Math.random() - 0.5);
}

function rgbDistance(a, b) {
  return Math.sqrt(
    Math.pow(a[0] - b[0], 2) +
    Math.pow(a[1] - b[1], 2) +
    Math.pow(a[2] - b[2], 2)
  );
}

function makeHand() {
  const hand = [];
  for (let i = 0; i < 4; i++) {
    hand.push({ ...pick(cardPool), id: makeId(), type: "normal", lineMode: "normal", trickEffect: null });
  }

  hand.push({ id: makeId(), type: "trick", effect: "reverse", name: "背景反轉" });
  hand.push({ id: makeId(), type: "trick", effect: "thin", name: "條紋變細" });
  hand.push({ id: makeId(), type: "trick", effect: "contrast", name: "對比強化" });

  return shuffle(hand);
}

function publicRoom(room) {
  return {
    code: room.code,
    phase: room.phase,
    round: room.round,
    maxRounds: MAX_ROUNDS,
    roundSeconds: ROUND_SECONDS,
    target: room.target,
    scores: room.scores,
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
    lastMessage: room.lastMessage
  };
}

function privateState(room, socketId) {
  const player = room.players.find(p => p.id === socketId);
  return {
    you: player ? { slot: player.slot, name: player.name } : null,
    hand: player ? player.hand : [],
    room: publicRoom(room)
  };
}

function emitRoom(room) {
  room.players.forEach(p => {
    io.to(p.id).emit("state", privateState(room, p.id));
  });
}

function startGame(room) {
  room.round = 1;
  room.scores = { A: 0, B: 0 };
  room.results = [];
  room.winner = null;
  room.lastMessage = "遊戲開始！";
  startRound(room);
}

function startRound(room) {
  if (room.timer) clearTimeout(room.timer);

  room.phase = "selecting";
  room.target = pick(targetPool);
  room.selections = { A: null, B: null };
  room.endsAt = Date.now() + ROUND_SECONDS * 1000;
  room.lastMessage = `第 ${room.round} 回合開始`;

  room.players.forEach(p => {
    p.hand = makeHand();
    p.usedTricks = [];
    p.selectedSecondsLeft = null;
  });

  room.timer = setTimeout(() => {
    revealRound(room, true);
  }, ROUND_SECONDS * 1000);

  emitRoom(room);
}

function revealRound(room, timeout = false) {
  if (!room || room.phase !== "selecting") return;

  if (room.timer) clearTimeout(room.timer);
  room.phase = "revealed";

  const cardA = room.selections.A;
  const cardB = room.selections.B;

  const distA = cardA ? rgbDistance(room.target, cardA.center) : null;
  const distB = cardB ? rgbDistance(room.target, cardB.center) : null;

  let winner = null;
  let resultText = "";

  if (cardA && cardB) {
    if (Math.abs(distA - distB) < 0.001) {
      resultText = "本回合平手";
    } else if (distA < distB) {
      room.scores.A += 1;
      winner = "A";
      resultText = "玩家 A 得分";
    } else {
      room.scores.B += 1;
      winner = "B";
      resultText = "玩家 B 得分";
    }
  } else if (cardA && !cardB) {
    room.scores.A += 1;
    winner = "A";
    resultText = "玩家 B 未出牌，玩家 A 得分";
  } else if (!cardA && cardB) {
    room.scores.B += 1;
    winner = "B";
    resultText = "玩家 A 未出牌，玩家 B 得分";
  } else {
    resultText = "雙方皆未出牌，本回合無人得分";
  }

  const pA = room.players.find(p => p.slot === "A");
  const pB = room.players.find(p => p.slot === "B");

  room.results.push({
    round: room.round,
    target: room.target,
    A: cardA ? {
      center: cardA.center,
      base: cardA.base,
      stripe: cardA.stripe,
      distance: distA,
      usedTricks: pA ? pA.usedTricks : [],
      selectedSecondsLeft: pA ? pA.selectedSecondsLeft : null
    } : null,
    B: cardB ? {
      center: cardB.center,
      base: cardB.base,
      stripe: cardB.stripe,
      distance: distB,
      usedTricks: pB ? pB.usedTricks : [],
      selectedSecondsLeft: pB ? pB.selectedSecondsLeft : null
    } : null,
    winner,
    resultText,
    timeout
  });

  room.lastMessage = resultText;

  if (room.round >= MAX_ROUNDS) {
    endGame(room);
  }

  emitRoom(room);
}

function endGame(room) {
  room.phase = "ended";
  if (room.scores.A === room.scores.B) {
    room.winner = "平手";
  } else {
    room.winner = room.scores.A > room.scores.B ? "玩家 A" : "玩家 B";
  }
}

function applyTrick(room, player, effect) {
  const opponent = room.players.find(p => p.slot !== player.slot);
  if (!opponent) return;

  player.usedTricks.push(effect);

  opponent.hand.forEach(card => {
    if (card.type !== "normal") return;

    if (effect === "reverse") {
      const temp = card.base;
      card.base = card.stripe;
      card.stripe = temp;
      card.trickEffect = "reverse";
    }

    if (effect === "thin") {
      card.lineMode = "thin";
      card.trickEffect = "thin";
    }

    if (effect === "contrast") {
      card.base = card.base.map(v => v > 128 ? 255 : Math.max(0, v - 45));
      card.stripe = card.stripe.map(v => v > 128 ? 255 : Math.max(0, v - 20));
      card.trickEffect = "contrast";
    }
  });

  const label = effect === "reverse" ? "背景反轉" : effect === "thin" ? "條紋變細" : "對比強化";
  room.lastMessage = `玩家 ${player.slot} 使用搗亂牌：${label}`;
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
      scores: { A: 0, B: 0 },
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
      endsAt: null,
      lastMessage: "等待第二位玩家加入"
    };

    rooms[roomCode] = room;
    socket.join(roomCode);
    socket.emit("created", { code: roomCode });
    emitRoom(room);
  });

  socket.on("joinRoom", data => {
    const roomCode = String(data && data.code ? data.code : "").trim().toUpperCase();
    const room = rooms[roomCode];

    if (!room) {
      socket.emit("errorMessage", "找不到房間");
      return;
    }

    if (room.players.length >= 2) {
      socket.emit("errorMessage", "房間已滿");
      return;
    }

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

    // 第二位玩家加入後自動開始，不需要再按開始
    startGame(room);
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

    if (room.selections.A && room.selections.B) {
      revealRound(room, false);
    } else {
      emitRoom(room);
    }
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

    startGame(room);
  });

  socket.on("disconnect", () => {
    Object.values(rooms).forEach(room => {
      const player = room.players.find(p => p.id === socket.id);
      if (player) {
        player.connected = false;
        emitRoom(room);
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log("server running on", PORT));
