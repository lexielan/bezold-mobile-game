const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);

app.use(express.static("./"));

let rooms = {};

function makeRoomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

io.on("connection", (socket) => {
  console.log("玩家連線:", socket.id);

  socket.on("createRoom", (data) => {
    const roomCode = makeRoomCode();

    rooms[roomCode] = {
      players: [socket.id]
    };

    socket.join(roomCode);

    socket.emit("created", { code: roomCode });

    console.log("建立房間:", roomCode);
  });

  socket.on("joinRoom", (data) => {
    const roomCode = data.code.toUpperCase();

    if (!rooms[roomCode]) {
      socket.emit("errorMessage", "房間不存在");
      return;
    }

    if (rooms[roomCode].players.length >= 2) {
      socket.emit("errorMessage", "房間已滿");
      return;
    }

    rooms[roomCode].players.push(socket.id);
    socket.join(roomCode);

    io.to(roomCode).emit("state", {
      room: {
        code: roomCode,
        players: rooms[roomCode].players
      }
    });

    console.log("玩家加入房間:", roomCode);
  });
});

const PORT = process.env.PORT || 3000;

http.listen(PORT, () => {
  console.log("伺服器啟動:", PORT);
});