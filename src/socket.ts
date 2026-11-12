import { io } from 'socket.io-client';

const SOCKET_URL = 'http://localhost:5001'; 

// Turn OFF autoConnect so it waits for the user to log in and get a token
export const socket = io(SOCKET_URL, {
  autoConnect: false,
});