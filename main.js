const {app, Menu, ipcMain, globalShortcut, Notification} = require('electron')
const {menubar} = require('menubar');
const Store = require('electron-store');
const store = new Store();
const express = require('express');
const expressApp = express();
const bodyParser = require('body-parser');
const path = require('path');
// const { updateElectronApp } = require('update-electron-app');

const iconPath = path.join(__dirname, 'images', 'icon@2x.png');
const debug = false;
const contextMenu = Menu.buildFromTemplate([
    {label: 'Quit', type: "normal", click: app.quit}
])

const HID = require('node-hid');
let deviceIsConnected = false;
let dev = {};
const properties = {
    // percent 0-100
    "brightness": 0x10,
    // percent 0-100
    "contrast": 0x12,
    // from 0 to 10
    "sharpness": 0x87,
    // percent 0-100
    "volume": 0x62,
    // Blue light reduction. 0 means no reduction
    "low-blue-light": 0xe00b,
    // Switch KVM to device 0 or 1
    "kvm-switch": 0xe069,
    // 0 is cool, 1 is normal, 2 is warm, 3 is user-defined
    "colour-mode": 0xe003,
    // Red value -- only works if colour-mode is set to 3
    "rgb-red": 0xe004,
    // Green value -- only works if colour-mode is set to 3
    "rgb-green": 0xe005,
    // Blue value -- only works if colour-mode is set to 3
    "rgb-blue": 0xe006
}

const mb = menubar({
    browserWindow: {
        width: 150,
        height: 38,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    },
    icon: iconPath,
    tooltip: 'Gigabyte monitor control'
});


function showNotification(titleText, bodyText) {
    new Notification({title: titleText, body: bodyText}).show()
}


mb.on('ready', () => {

    if (require('electron-squirrel-startup')) app.quit();


    ipcMain.on('brightness-change', (event, arg) => {
        setBrightness(arg);
    });
    mb.tray.on('right-click', () => {
        mb.tray.popUpContextMenu(contextMenu);
    });

    setShortcuts();
    app.setLoginItemSettings({
        openAtLogin: false,
        openAsHidden: true
    });
    connectToDevice();
});

function setShortcuts() {
    // TODO move shortcuts to settings
    globalShortcut.register('Alt+CommandOrControl+Shift+=', () => {
        setBrightness(parseInt(store.get('brightness')) + 10);
    });
    globalShortcut.register('Alt+CommandOrControl+Shift+-', () => {
        setBrightness(parseInt(store.get('brightness')) - 10);
    });
}

function setBrightness(brightness) {
    setProperty("brightness", brightness);
}

// Listener for incoming requests from home assistant
expressApp.use(bodyParser.urlencoded({extended: false}))

expressApp.listen(3000, () => {
    console.log("Server running on port 3000");
});

expressApp.post("/monitor-settings", (req, res, next) => {
    let brightness = req.body.brightness;
    setBrightness(brightness);
    res.json({"receivedMessage": brightness});
});

expressApp.post("/monitor-settings", (req, res, next) => {
    const brightness = req.body.brightness;
    setBrightness(brightness);
    res.json({"receivedMessage": brightness});
});


if (debug) {
    mb.on('after-create-window', devMode)
}

function devMode() {
    mb.window.openDevTools();
}


function connectToDevice() {
    try {
        const devices = HID.devices();
        // Realtek HID Device + USB Hub
        const devInfo = devices.find(device => device.vendorId === 0x0bda && device.productId === 0x1100);
        dev = new HID.HID(devInfo.path);
        //deviceIsConnected = true;

    } catch (error) {
        console.error("Error connecting to device:", error);
        setTimeout(connectToDevice, 3000); // Retry after 3 seconds
    }
}

async function setProperty(propName, value) {

    console.log(dev);

    if (value > 100 || value < 0) {
        return;
    }

    let propCode = properties[propName];
    const buf = Buffer.alloc(193);

    buf[0] = 0;
    Buffer.from([0x40, 0xc6]).copy(buf, 1);
    Buffer.from([0x20, 0, 0x6e, 0, 0x80]).copy(buf, 1 + 6);

    let msg = [];

    if (propCode > 0xff) {
        msg.push(propCode >> 8);
        propCode &= 0xff;
    }

    msg.push(propCode, 0, value);

    let preamble = [0x51, 0x81 + msg.length, 0x03];

    Buffer.from(preamble.concat(msg)).copy(buf, 1 + 0x40);


    try {
        dev.write(buf);
        store.set(propName, value);
        console.log(`Property ${propName} set to ${value}`);
    } catch (error) {
        console.error(error);
        showNotification('Error', 'Monitor not connected, trying to reconnect...');
        connectToDevice();
    }
}
