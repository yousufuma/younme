const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);
const port = process.env.PORT || 3000;

if (process.env.NODE_ENV !== "production") {
  app.get("/__preview", (request, response) => {
    response.sendFile(path.join(__dirname, "dev", "preview.html"));
  });
}

app.use(express.static("public"));

io.on("connection", (socket) => {
  socket.on("room_connect", (requestedRoom) => {
    const room =
      typeof requestedRoom === "string" && requestedRoom.trim()
        ? requestedRoom.trim().slice(0, 256)
        : "Shared Space";

    if (socket.data.room) {
      socket.leave(socket.data.room);
    }

    socket.data.room = room;
    socket.join(room);

    const members = Array.from(io.sockets.adapter.rooms.get(room) || []);
    socket.emit(
      "listresults",
      members.filter((id) => id !== socket.id)
    );
  });

  socket.on("signal", (to, from, data) => {
    const target = io.sockets.sockets.get(to);
    const room = socket.data.room;

    if (target && room && target.rooms.has(room)) {
      target.emit("signal", to, from, data);
    }
  });

  socket.on("disconnect", () => {
    if (socket.data.room) {
      socket.to(socket.data.room).emit("peer_disconnect", socket.id);
    }
  });
});

httpServer.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
