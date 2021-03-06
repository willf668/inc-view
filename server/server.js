const fs = require("fs");
const http = require("http");
const https = require("https");
const { v4: uuidv4 } = require("uuid");
const readline = require("readline");
const nodemailer = require("nodemailer");
require("../enumsModule.js"); //Load the enum

const buf = Buffer.alloc(512); //Standard data buffer
const bufLarge = Buffer.alloc(4096); //Large data buffer for JSON data

const serverList = {}; //uid => {location, adjacent[], default(OPTIONAL)}
const coachClientList = {}; //uid => {viewingNode, socket, name}
const participantClientList = {}; //uid => { socket, name}
const locationToServer = {};
const layoutData = JSON.parse(fs.readFileSync("./layout.json"));
Object.values(layoutData).forEach(obj => {
  if (!("name" in obj)) obj.name = obj.roomName;
  obj.status = 1;
  obj.count = 0;
});
const participantLocations = JSON.parse(
  fs.readFileSync("./participantLocations.json")
);
Object.keys(layoutData).forEach((location) => {
  layoutData[location].inactive = true;
});

const transporter = nodemailer.createTransport({
  service: "gmail",
  host: "smtp.gmail.com",
  secure: true,
  auth: {
    user: "wfwebsitemanager",
    pass: "potato55",
  },
});

let participantData = {};
let coachData = {};
function loadPeople() {
  let coachPath = "./coaches.json";
  const now = new Date();
  if (now.getMonth() === 6 && now.getDay() > 13 && now.getDay() < 20)
    coachPath = "./coachesDay" + (now.getDay() - 13) + ".json";
  participantData = JSON.parse(fs.readFileSync("./participants.json"));
  let _data = JSON.parse(fs.readFileSync(coachPath));
  coachData = {};
  let list = Object.keys(_data).sort();
  list.forEach((coach) => {
    coachData[coach] = _data[coach];
    if (!("photo" in coachData[coach]))
      coachData[coach].photo = "https://www.gravatar.com/avatar/" + uuidv4();
    if (!("bio" in coachData[coach])) coachData[coach].bio = "Bio goes here";
    if (!("email" in coachData[coach]) || coachData[coach].email === "") coachData[coach].email = "willf668@gmail.com";
    if (!("tags" in coachData[coach])) coachData[coach].tags = [];
  });

  let timeUntil = 15 - (now.getMinutes() % 15);
  const tomorrow = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours(),
    now.getMinutes() + timeUntil,
    now.getSeconds() // ...at 00:00:00 hours
  );
  setTimeout(function () {
    loadPeople();
  }, tomorrow.getTime() - now.getTime());
}
loadPeople();

let io = require("socket.io");
server = http
  .createServer((req, res) => {
    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "Origin, X-Requested-With, Content-Type, Accept, Authorization",
    });
  })
  .listen(8080);
io = io(server, {
  origins: "*",
});

let defaultServer = "";

function updateCount(socket, oldRoom, newRoom) {
  if (oldRoom !== "") layoutData[oldRoom].count-=1;
  if (newRoom !== "") layoutData[newRoom].count+=1;
  Object.values(coachClientList).forEach((coach) => {
    coach.socket.send(JSON.stringify({
      header: packetType.moveRoom,
      decrease: coachClientList[socket.uid].viewingNode,
      increase: newRoom
    }));
  });
  coachClientList[socket.uid].viewingNode = newRoom;
}

function setClientViewing(socket, location) {
  //Assign a client to a specific node
  updateCount(socket, coachClientList[socket.uid].viewingNode, location);
  let data = -1;
  if (location !== "") {
    data = serverList[locationToServer[location]];
    data.header = packetType.clientStartViewing;
    delete data.socket;
  } else {
    data = {
      header: packetType.clientStartViewing,
      location: "",
    };
  }
  socket.send(JSON.stringify(data));
}
function sendLayout() {
  const _data = JSON.stringify({
    header: packetType.nodeLayout,
    data: layoutData,
  });
  Object.keys(coachClientList).forEach((client) => {
    coachClientList[client].socket.send(_data);
  });
}
function disconnect(socket) {
  if (socket.clientType === -1) return;
  //Socket disconnects
  console.log("Disconnect");
  if (socket.clientType === 0 && !(socket.uid in serverList)) return;
  if (socket.isNode) {
    //Node
    const _location = serverList[socket.uid].location;
    layoutData[_location].inactive = true;
    sendLayout();
    if (defaultServer === _location) defaultServer = ""; //Reset defaultServer
    Object.keys(coachClientList).forEach((client) => {
      //Disconnect clients from this node
      if (coachClientList[client].viewingNode === _location) {
        setClientViewing(coachClientList[client].socket, defaultServer);
      }
    });

    delete locationToServer[_location];
    delete serverList[socket.uid];
  } else if (socket.clientType === 1) {
    //Coach
    updateCount(socket, coachClientList[socket.uid].viewingNode, "");
    delete coachClientList[socket.uid];
  } else if (socket.clientType === 2) {
    //Participant
    delete participantClientList[socket.uid];
  }
}
io.on("connection", function (socket) {
  console.log("Connection");
  socket.uid = uuidv4(); //Unique socket id
  socket.isNode = false;
  socket.clientType = 0; //-1: status, 0: server, 1: coach, 2: participant
  socket.on("message", function (data) {
    data = JSON.parse(data); //Parse data as a JS object
    switch (data.header) {
      case packetType.serverConnect: //Node connects
        if (data.location !== null && data.location in layoutData) {
          console.log("Node added");
          socket.isNode = true;
          if (socket.uid in serverList) {
            layoutData[serverList[socket.uid].location].inactive = true;
            delete locationToServer[serverList[socket.uid].location];
            delete serverList[socket.uid];
          }
          serverList[socket.uid] = {
            location: data.location,
            socket: socket,
          };
          locationToServer[data.location] = socket.uid;
          delete layoutData[data.location].inactive;
          sendLayout();
          if ("default" in layoutData[data.location] || defaultServer === "") {
            defaultServer = data.location;
            setTimeout(function () {
              Object.keys(coachClientList).forEach((client) => {
                if (coachClientList[client].viewingNode === "") {
                  setClientViewing(
                    coachClientList[client].socket,
                    defaultServer
                  );
                }
              });
            }, 1000);
          }
          console.log("Server: " + defaultServer);
        }
        break;
      case packetType.clientConnect: //Client connects
        console.log("Coach connected");
        socket.clientType = 1;
        coachClientList[socket.uid] = {
          viewingNode: "",
          socket: socket,
          name: data.name,
        };
        data = {
          header: packetType.nodeLayout,
          data: layoutData,
        };
        socket.send(JSON.stringify(data));
        setClientViewing(socket, defaultServer);
        break;
      case packetType.participantConnect:
        console.log("Participant connected");
        socket.clientType = 2;
        participantClientList[socket.uid] = {
          socket: socket,
          name: data.name,
        };
        data = {
          header: packetType.participantGetCoaches,
          data: coachData,
        };
        socket.send(JSON.stringify(data));
        break;
      case packetType.participantRequestCoach:
        const room = participantLocations[data.name];
        const mailOptions = {
          from: "wfwebsitemanager@gmail.com",
          to: coachData[data.coachName].email,
          //cc: 'zach@tinyheadedkingdom.com',
          subject: "HW Inc - " + data.fullname + " is asking for help!",
          text: "Hello,\n\n" + data.fullname + "'s team (" + layoutData[room].name + " at " + layoutData[room].roomName + ") has requested your help!",
        };
        if (data.msg !== "") mailOptions.text += "\n\n'" + data.msg + "'";
        mailOptions.text +=
          "\n\nTo join, click here: https://hwincview.com";
        mailOptions.text += "\n\nThanks!\n-The Inc Team";

        transporter.sendMail(mailOptions, function (error, info) {
          if (error) {
            console.log(error);
          } else {
            console.log("Email sent: " + info.response);
          }
        });

        Object.values(coachClientList).forEach((coach) => {
          if (
            room !== coach.viewingNode &&
            coach.name === data.coachName.toLowerCase().replace(/\s/g, "")
          ) {
            coach.socket.send(
              JSON.stringify({
                header: packetType.coachRequested,
                room: room,
                name: data.name,
              })
            );
          }
        });
        break;
      case packetType.setStatus:
        socket.clientType = -1;
        layoutData[data.location].status = data.status;
        sendLayout();
        socket.disconnect();
        break;
      case packetType.moveRoom:
        updateCount(socket, coachClientList[socket.uid].viewingNode, data.location);
        break;
      default:
        break;
    }
  });

  socket.on("disconnect", function () {
    disconnect(socket);
  }); //Handle disconnect possibilities
  socket.on("error", function () {
    disconnect(socket);
  });
});

console.log("Server has started");
