const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const indexHtml = require("./views/index");
const { rtcConfigHandler } = require("./lib/rtc-config");

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  // The public p5LiveMedia signaling service uses its Socket.IO 2.x client.
  // Keep the local WebRTC preview compatible with that same client.
  allowEIO3: true,
});
const port = process.env.PORT || 3000;
const publicDirectory = path.join(__dirname, "public");

if (process.env.NODE_ENV !== "production") {
  app.get("/__preview", (request, response) => {
    response.sendFile(path.join(__dirname, "dev", "preview.html"));
  });
}

app.get("/", (request, response) => {
  response.type("html").send(indexHtml);
});

app.get("/api/rtc-config", rtcConfigHandler);

app.use(express.static(publicDirectory));

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

if (!process.env.VERCEL) {
  httpServer.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}

module.exports = httpServer;
