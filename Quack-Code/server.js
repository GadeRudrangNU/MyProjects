// server.js
const express = require("express");
const app = express();
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const ACTIONS = require("./src/Actions");

const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("build"));
app.use((req, res, next) => {
  res.sendFile(path.join(__dirname, "build", "index.html"));
});

const userSocketMap = {};

function getAllConnectedClients(roomId) {
  return Array.from(io.sockets.adapter.rooms.get(roomId) || []).map(
    (socketId) => ({
      socketId,
      username: userSocketMap[socketId],
    })
  );
}

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.on(ACTIONS.JOIN, ({ roomId, username }) => {
    userSocketMap[socket.id] = username;
    socket.join(roomId);
    const clients = getAllConnectedClients(roomId);
    // Broadcast to everyone in the room (including the joining user) that the client list has updated
    io.in(roomId).emit(ACTIONS.JOINED, {
      clients,
      username,
      socketId: socket.id,
    });
  });

  socket.on(ACTIONS.CODE_CHANGE, ({ roomId, code }) => {
    socket.to(roomId).emit(ACTIONS.CODE_CHANGE, { code });
  });

  socket.on(ACTIONS.SYNC_CODE, ({ socketId, code }) => {
    io.to(socketId).emit(ACTIONS.CODE_CHANGE, { code });
  });

  socket.on(ACTIONS.CURSOR_CHANGE, ({ roomId, cursor }) => {
    socket.to(roomId).emit(ACTIONS.CURSOR_CHANGE, {
      socketId: socket.id,
      cursor,
      username: userSocketMap[socket.id],
    });
  });

  // Use broadcast so that the leaving socket does not get the event
  socket.on(ACTIONS.LEAVE, ({ roomId, username }) => {
    socket.broadcast.to(roomId).emit(ACTIONS.DISCONNECTED, {
      socketId: socket.id,
      username,
    });
    socket.leave(roomId);
    delete userSocketMap[socket.id];
    // Optionally, recalculate and broadcast updated client list:
    const clients = getAllConnectedClients(roomId);
    io.in(roomId).emit(ACTIONS.CLIENTS_UPDATE, { clients });
  });

  // When a user disconnects (for example by closing the tab)
  socket.on("disconnect", () => {
    // Get all rooms the socket was in (except its own room)
    const rooms = [...socket.rooms].filter((room) => room !== socket.id);
    rooms.forEach((roomId) => {
      socket.broadcast.to(roomId).emit(ACTIONS.DISCONNECTED, {
        socketId: socket.id,
        username: userSocketMap[socket.id],
      });
      const clients = getAllConnectedClients(roomId);
      io.in(roomId).emit(ACTIONS.CLIENTS_UPDATE, { clients });
    });
    delete userSocketMap[socket.id];
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Listening on port ${PORT}`));
