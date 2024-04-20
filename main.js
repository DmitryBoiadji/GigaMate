// const { app, BrowserWindow } = require('electron/main')
const path = require('node:path')
const { app, Menu, Tray, BrowserWindow} = require('electron')
const { exec } = require("child_process");
const Store = require('electron-store');


let tray = null
function createTray(){

    let tray = new Tray(path.join(__dirname, 'images/logo.png'))

    const contextMenu = Menu.buildFromTemplate([
        { label: 'settings', type: 'normal', click: createWindow },
        // { label: 'Popup', type: 'normal', click: createWindow },
        // { label: 'Item3', type: 'radio', checked: true },
        // { label: 'Item4', type: 'radio'},
        // { type: 'separator' },
        { label: 'exit', type: "normal", click: app.quit}
    ])
    tray.setToolTip('Control GigabiteM32q Monitor')

  //  tray.on("click", createWindow);
  //  tray.on("right-click", contextMenu);

    const store = new Store();

    store.set('unicorn', 'Z');
    console.log(store.get('unicorn'));


    tray.setContextMenu(contextMenu)
}





function createWindow () {

    const win = new BrowserWindow({
        width: 400,
        height: 400,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js')
        }
    })




    exec("ls -la", (error, stdout, stderr) => {
        if (error) {
            console.log(`error: ${error.message}`);
            return;
        }
        if (stderr) {
            console.log(`stderr: ${stderr}`);
            return;
        }
        console.log(`stdout: ${stdout}`);
    });




    win.loadFile('index.html')
}

app.whenReady().then(() => {
 //   createWindow();
    createTray();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow()
        }
    })
})

app.on('window-all-closed', () => {
   app.quit()
})






