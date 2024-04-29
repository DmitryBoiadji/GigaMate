const {app, Menu, ipcMain} = require('electron')
const {menubar} = require('menubar');
const Store = require('electron-store');
const store = new Store();
const express = require('express');
const bodyParser = require('body-parser');
const {exec} = require("child_process");
const expressApp = express();
const path = require('path');
const iconPath = path.join(__dirname, 'assets', 'IconTemplate.png');
const debug = false;
const contextMenu = Menu.buildFromTemplate([
    {label: 'exit', type: "normal", click: app.quit}
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
        console.log(arg);
        setBrightness(arg);
    });
    mb.tray.on('right-click', () => {
        mb.tray.popUpContextMenu(contextMenu);
    });
});

function setBrightness(brightness) {
    exec("~/go/bin/gbmonctl -prop brightness -val " + brightness, (error, stdout, stderr) => {
        if (error) {
            console.log(`error: ${error.message}`);
            return;
        }
        if (stderr) {
            store.set('brightness', parseInt(brightness));
            console.log(`stderr: ${stderr}`);
            return;
        }
        console.log(`stdout: ${stdout}`);
    });
}

// Listener for incoming requests from home assistant
expressApp.use(bodyParser.urlencoded({extended: false}))

expressApp.listen(3000, () => {
    console.log("Server running on port 3000");
});

expressApp.post("/monitor-settings", (req, res, next) => {

    console.log(req.body)
    const brightness = req.body.brightness;
    setBrightness(brightness);

    res.json({"receivedMessage": brightness});
});


expressApp.post("/monitor-settings", (req, res, next) => {

    console.log(req.body)
    const brightness = req.body.brightness;
    setBrightness(brightness);

    res.json({"receivedMessage": brightness});
});


if(debug){
    mb.on('after-create-window', devMode)
}

function devMode() {
    mb.window.openDevTools();
}