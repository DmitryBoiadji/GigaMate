const path = require('node:path')
const {app, Menu, Tray, BrowserWindow, ipcRenderer, ipcMain} = require('electron')
const {exec} = require("child_process");
const Store = require('electron-store');
let tray = null
const store = new Store();
const express = require('express');
const bodyParser = require('body-parser');

const expressApp = express();
// parse application/x-www-form-urlencoded
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

function createTray() {
    let tray = new Tray(path.join(__dirname, 'images/logo.png'))
    const contextMenu = Menu.buildFromTemplate([
        {label: 'settings', type: 'normal', click: createWindow},
        {label: 'exit', type: "normal", click: app.quit}
    ])
    tray.setToolTip('Control GigabiteM32q Monitor')
    tray.setContextMenu(contextMenu)
}

function createWindow() {

    const win = new BrowserWindow({
        width: 400,
        height: 400,
        titleBarStyle: 'hidden',
        titleBarOverlay: false,

        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    })

    win.loadFile('index.html')
    ipcMain.on('brightness-change', (event, arg) => {
        console.log(arg);
        setBrightness(arg);
    });

}

app.whenReady().then(() => {
    //   createWindow();
    createTray();
    let initialBrightness = store.get('brightness');


    if(initialBrightness){
        setBrightness(initialBrightness);
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow()
        }
    })
})

app.on('window-all-closed', () => {
    app.quit()
})






