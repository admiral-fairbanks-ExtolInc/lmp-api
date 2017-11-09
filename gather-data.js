const async = require('async');
const moment = require('moment');
const main = require('../main');

let childAddresses;
let targetHeater;
let statusBroadcasted;
let statusProcessed;
let readingFinished;
const heaterTypes = new Array(childAddresses.length);
const individualData = {
  timestampId: moment().format('MMMM Do YYYY, h:mm:ss a'),
  startData: {
    startTime: 0,
    startTemp: 0,
    startPos: 0,
  },
  atSetpointData: {
    atSetpointTime: 0,
    atSetpointTemp: 0,
    atSetpointPos: 0,
  },
  contactDipData: {
    contactDipTime: 0,
    contactDipTemp: 0,
    contactDipPos: 0,
  },
  shutoffData: {
    shutoffTime: 0,
    shutoffTemp: 0,
    shutoffPos: 0,
  },
  cycleCompleteData: {
    cycleCompleteTime: 0,
    cycleCompleteTemp: 0,
    cycleCompletePos: 0,
  },
};

// Broadcasts data to all children
const broadcastData = (statusMessageBuffer) => {
  main.i2c1.i2cWrite(0, statusMessageBuffer.byteLength, statusMessageBuffer)
    .then((err, bytesWritten) => {
      if (err) throw (err);
      else if (bytesWritten !== statusMessageBuffer.byteLength) {
        // throw ('Bytes written does not match expected amount.');
      }
      if (main.dataloggingInfo) main.logRequestSent = true;
    });
};
// Reads data obtained from all children
const readData = () => {
  let readLength;
  let targetChild;
  if (main.tempInfo === false && main.dataloggingInfo === false) readLength = 1;
  else if (main.tempInfo === true && main.dataloggingInfo === false) readLength = 9;
  else if (main.dataloggingInfo === true) readLength = 129;
  main.i2c1.i2cRead(targetChild, readLength, main.infoBuffers)
    .then((err, bytesRead, recievedMessage) => {
      if (err) throw (err);
      else if (bytesRead !== readLength) {
        // throw ('Bytes written does not match expected amount.');
      }
      main.infoBuffers[targetChild] = recievedMessage;
      targetChild += 1;
      if (targetChild >= main.infoBuffers.length) {
        return;
      }
    })
    .then(readData());
};
// Processes data from all children. Includes datalogging to Mongodb
const processData = (data) => {
  let datalogIndex;
  const overallStatus = new Array(data.length);
  const heaterStatus = {
    lmpTemps: [0.0, 0.0, 0.0, 0.0],
    heaterCycleRunning: false,
    heaterAtSetpoint: false,
    heaterAtRelease: false,
    heaterCycleComplete: false,
    heaterFaulted: false,
    cycleDatalogged: false,
  };

  if (!statusProcessed) {
    for (let i = 0, l = data.length; i < l; i += 1) {
      const statusByte = data[i].readInt8(0);
      if ((statusByte & 1) === 1) { heaterStatus.heaterCycleRunning = true; }
      if ((statusByte & 2) === 2) { heaterStatus.heaterAtSetpoint = true; }
      if ((statusByte & 4) === 4) { heaterStatus.heaterAtRelease = true; }
      if ((statusByte & 8) === 8) { heaterStatus.heaterCycleComplete = true; }
      if ((statusByte & 16) === 16) { heaterStatus.heaterFaulted = true; }
      if ((statusByte & 32) === 32) { heaterStatus.cycleDatalogged = true; }
      for (let j = 0; j < 4; j += 4) {
        heaterStatus.lmpTemps[j] = data[i].readInt16BE(1) / 10;
      }
      overallStatus[i] = heaterStatus;
    }
    statusProcessed = true;
    main.childStatuses = overallStatus;
  }

  if (main.dataloggingInfo === true) {
    const k = 30 * targetHeater;
    individualData.timestampId = moment().format('MMMM Do YYYY, h:mm:ss a');
    individualData.startData.startTime = data[datalogIndex]
      .readInt16BE(9 + k) / 100;
    individualData.startData.startTemp = data[datalogIndex]
      .readInt16BE(11 + k) / 10;
    individualData.startData.startPos = data[datalogIndex]
      .readInt16BE(13 + k) / 100;
    individualData.atSetpointData.atSetpointTime = data[datalogIndex]
      .readInt16BE(15 + k) / 100;
    individualData.atSetpointData.atSetpointTemp = data[datalogIndex]
      .readInt16BE(17 + k) / 10;
    individualData.atSetpointData.atSetpointPos = data[datalogIndex]
      .readInt16BE(19 + k) / 100;
    individualData.contactDipData.contactDipTime = data[datalogIndex]
      .readInt16BE(21 + k) / 100;
    individualData.contactDipData.contactDipTemp = data[datalogIndex]
      .readInt16BE(23 + k) / 10;
    individualData.contactDipData.contactDipPos = data[datalogIndex]
      .readInt16BE(25 + k) / 100;
    individualData.shutoffData.shutoffTime = data[datalogIndex]
      .readInt16BE(27 + k) / 100;
    individualData.shutoffData.shutoffTemp = data[datalogIndex]
      .readInt16BE(29 + k) / 10;
    individualData.shutoffData.shutoffPos = data[datalogIndex]
      .readInt16BE(31 + k) / 100;
    individualData.cycleCompleteData.cycleCompleteTime = data[datalogIndex]
      .readInt16BE(33 + k) / 100;
    individualData.cycleCompleteData.cycleCompleteTemp = data[datalogIndex]
      .readInt16BE(35 + k) / 10;
    individualData.cycleCompleteData.cycleCompletePos = data[datalogIndex]
      .readInt16BE(37 + k) / 100;
    main.db.collection('Heater_Database').update(
      {
        heaterId: {
          heaterNumber: 1 + datalogIndex + targetHeater,
        },
      },
      {
        $push: { dataLog: individualData },
      },
    )
      .then((err) => {
        if (err) throw (err);
        if (err) throw (err);

        targetHeater += 1;
        if (targetHeater >= 4) {
          targetHeater = 0;
          datalogIndex += 1;
        }
        if (datalogIndex >= data.length) {
          datalogIndex = 0;
          statusProcessed = false;
          return;
        }
      })
      .then(processData(data, main.childStatuses));
  }
};


// function Declarations
// Creates datalog Template
function templateGet(index, htrNum, htrType, address) {
  const heaterTemplate = {
    heaterId: {
      heaterNumber: (htrNum + index),
      lmpType: htrType,
      controllerNumber: index,
      heaterI2cAddress: address,
    },
    dataLog: {
      timestampId: moment().format('MMMM Do YYYY, h:mm:ss a'),
      startData: {
        startTime: 0,
        startTemp: 0,
        startPos: 0,
      },
      atSetpointData: {
        atSetpointTime: 0,
        atSetpointTemp: 0,
        atSetpointPos: 0,
      },
      contactDipData: {
        contactDipTime: 0,
        contactDipTemp: 0,
        contactDipPos: 0,
      },
      shutoffData: {
        shutoffTime: 0,
        shutoffTemp: 0,
        shutoffPos: 0,
      },
      cycleCompleteData: {
        cycleCompleteTime: 0,
        cycleCompleteTemp: 0,
        cycleCompletePos: 0,
      },
    },
  };
  return heaterTemplate;
}

// Populates Database with blank datalog
function populateDatabase() {
  main.i2c1.scan()
    .then((err, devices) => {
      if (err) throw (err);
      childAddresses = devices;
    })
    .then(main.i2c1.sendByte(0, 1)
      .then((err) => {
        if (err) throw (err);
      }))
    .then(async.eachOfSeries(childAddresses, (item, key) => {
      main.i2c1.read(item, 4)
        .then((err, bytesRead, recievedMessage) => {
          heaterTypes[key] = recievedMessage;
        });
    }))
    .then(() => {
      for (let ind = 0, l = childAddresses.length; ind < l; ind += 1) {
        main.db.collection('Heater_Database').insertMany([
          templateGet(ind, 1, heaterTypes[ind][0], childAddresses[ind]),
          templateGet(ind, 2, heaterTypes[ind][1], childAddresses[ind]),
          templateGet(ind, 3, heaterTypes[ind][2], childAddresses[ind]),
          templateGet(ind, 4, heaterTypes[ind][3], childAddresses[ind]),
        ]);
      }
    })
    .then(() => { main.heatersMapped = true; });
}

// Boilerplate callback
function cb(err) {
  if (err) throw (err);
}

// End Function Declarations

exports.templateGet = templateGet;
exports.populateDatabase = populateDatabase;
exports.broadcastData = broadcastData;
exports.readData = readData;
exports.processData = processData;
exports.cb = cb;
module.exports = {
  childAddresses,
  statusBroadcasted,
  readingFinished,
  statusProcessed,
};
