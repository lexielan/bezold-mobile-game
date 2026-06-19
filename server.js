const express = require("express");
const app = express();

const http = require("http").createServer(app);

const io = require("socket.io")(http, {
  cors: {
    origin: "*"
  }
});

app.use(express.static("./"));

let rooms = {};

io.on("connection", (socket) => {

  console.log("玩家連線:", socket.id);

  socket.on("createRoom", (roomCode) => {

    rooms[roomCode] = {
      players: [socket.id]
    };

    socket.join(roomCode);

    socket.emit("roomCreated", roomCode);

    console.log("建立房間:", roomCode);

  });

  socket.on("joinRoom", (roomCode) => {

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

    io.to(roomCode).emit("gameStart");

    console.log("玩家加入:", roomCode);

  });

  socket.on("sendGameData", (data) => {

    socket.to(data.roomCode).emit("receiveGameData", data);

  });

  socket.on("disconnect", () => {

    console.log("玩家離線");

  });

});

const PORT = process.env.PORT || 3000;

http.listen(PORT, () => {

  console.log("伺服器啟動:", PORT);

});