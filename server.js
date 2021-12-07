// let fs = require('fs');
let express = require('express');
let app = express();

var cors = require('cors');
app.use(cors(
{
	origin: /p5js\.org$/,
	optionsSuccessStatus: 200 
}
));

// let server = app.listen(3000);
app.use(express.static('public'));

let http = require('http');

let httpServer = http.createServer(app);
https://github.com/yousufuma/younme/blob/main/server.js
let port = process.env.port || 3000;

httpServer.listen(port, ()=>{
    console.log('Server listening on port ', port);
  });
  

let peers = {};

let io = require('socket.io');
io = new io.Server(httpServer);

io.sockets.on('connection', (socket) => {
    console.log('We have a new client: ', socket.id);
    /*STEP 3.1. Add socket to 'peers' object*/
    peers[socket.id] = socket;

    socket.on('list', () => {
        //get an ids array
        let ids = Object.keys(peers);
        console.log(ids);

        socket.emit('listresults', ids);
  });

  socket.on('signal', (to, from, data) => {
    console.log('signal', to, data);
    if(to in peers){
        //send signal to that peer
        peers[to].emit('signal', to, from, data);
      }else{
        console.log('Peer not found');
      };
    });
  
    socket.on('disconnect', () => {
      console.log('Socket disconnected: ', socket.id);
  
      io.emit('peer_disconnect', socket.id);
  
      /*STEP 3.2. Delete from 'peers' object*/
      delete peers[socket.id];
    });
  });

    

    




// io.sockets.on('connection', 
// function (socket) {

//     console.log(Date.now(), socket.id, "New client");
//     socket.on('room_connect', function(room) {
//         console.log(Date.now(), socket.id, room, 'room_connect');

//         if (!rooms.hasOwnProperty(room)) {
//             console.log(Date.now(), socket.id, "room doesn't exist, creating it");
//             rooms[room] = [];
//         }
//         rooms[room].push(socket);
//         socket.room = room;

//         console.log(Date.now(), socket.id, rooms);

//         let ids = [];
//         for (let i = 0; i < rooms[socket.room].length; i++) {
//             ids.push(rooms[socket.room][i].id);
//         }
//         console.log(Date.now(), socket.id, "ids length: " + ids.length);
//         socket.emit('listresults', ids);
//     });

//     socket.on('list', function() {
//         let ids = [];
//         for (let i = 0; i < rooms[socket.room].length; i++) {
//             ids.push(rooms[socket.room][i].id);
//         }
//         console.log(Date.now(), socket.id, "ids length: " + ids.length);
//         socket.emit('listresults', ids);			
//     });
    
//     // Relay signals back and forth
//     socket.on('signal', (to, from, data) => {
//         //console.log("SIGNAL", to, data);
//         let found = false;
//         for (let i = 0; i < rooms[socket.room].length; i++) {
//             //console.log(rooms[socket.room][i].id, to);
//             if (rooms[socket.room][i].id == to) {
//                 //console.log("Found Peer, sending signal");
//                 rooms[socket.room][i].emit('signal', to, from, data);
//                 found = true;
//                 break;
//             }				
//         }	
//         // if (!found) {
//         // 	console.log("never found peer");
//         // }
//     });
            
//     socket.on('disconnect', function() {
//         console.log(Date.now(), socket.id, "Client has disconnected");
//         if (rooms[socket.room]) { // Check on this
//             // Tell everyone first
//             let which = -1;
//             for (let i = 0; i < rooms[socket.room].length; i++) {
//                 if (rooms[socket.room][i].id != socket.id) {
//                     rooms[socket.room][i].emit('peer_disconnect', socket.id);
//                 } else {
//                     which = i;
//                 }
//             }		
//             // Now remove from array
//             if (rooms[socket.room][which].id == socket.id) {
//                 rooms[socket.room].splice(which,1);
//             }		

//             // This could fail if someone joins while the loops are in progress
//             // Should be using associative arrays all the way around here
//         }
//     });
// }
// );


