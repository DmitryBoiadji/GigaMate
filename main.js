const {app, Menu, ipcMain, globalShortcut} = require('electron')
const {menubar} = require('menubar');
const Store = require('electron-store');
const store = new Store();
const express = require('express');
const expressApp = express();
const bodyParser = require('body-parser');
const path = require('path');

const iconPath = path.join(__dirname, 'images', 'icon@2x.png');
const debug = false;
const contextMenu = Menu.buildFromTemplate([
    {label: 'Quit', type: "normal", click: app.quit}
])

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

mb.on('ready', () => {

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

});

function setShortcuts() {
    // TODO move shortcuts to settings
    globalShortcut.register('Alt+CommandOrControl+Shift+=', () => {
        setBrightness(store.get('brightness') + 10);
    });
    globalShortcut.register('Alt+CommandOrControl+Shift+-', () => {
        setBrightness(store.get('brightness') - 10);
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

    console.log(req.body)
    let brightness = req.body.brightness;
    setBrightness(brightness);

    res.json({"receivedMessage": brightness});
});

expressApp.post("/monitor-settings", (req, res, next) => {

    console.log(req.body)
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

const HID = require('node-hid');
const devices = HID.devices();
const devInfo = devices.find(device => device.vendorId === 0x0bda && device.productId === 0x1100);
if (!devInfo) {
    throw new Error("Device not found.");
}
const dev = new HID.HID(devInfo.path);

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

async function setProperty(propName, value) {

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
    }
}


