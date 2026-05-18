'use strict';

const { Server } = require('socket.io');
const cfg = require('./index');

let ioInstance;

function initSocket(server) {
  const io = new Server(server, {
    cors:       cfg.SOCKET.cors,
    transports: cfg.SOCKET.transports,
  });

  ioInstance = io;
  return io;
}

function getSocket() {
  return ioInstance;
}

module.exports = { initSocket, getSocket };
