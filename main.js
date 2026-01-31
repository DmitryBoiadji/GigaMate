const {app, Menu, ipcMain, globalShortcut, Notification, BrowserWindow} = require('electron')
const {menubar} = require('menubar');
const Store = require('electron-store');
const store = new Store();
const express = require('express');
const expressApp = express();
const bodyParser = require('body-parser');
const path = require('path');

const iconPath = path.join(__dirname, 'images', 'icon@2x.png');
const debug = false;

let settingsWindow = null;
let httpServer = null;

// Default settings
const defaultSettings = {
    shortcuts: {
        brightnessUp: 'Alt+CommandOrControl+Shift+=',
        brightnessDown: 'Alt+CommandOrControl+Shift+-',
        contrastUp: '',
        contrastDown: '',
        volumeUp: '',
        volumeDown: ''
    },
    startup: {
        openAtLogin: false,
        startHidden: true
    },
    api: {
        enabled: true,
        port: 3000
    },
    defaults: {
        brightness: 50,
        contrast: 50,
        volume: 50
    }
};

function getSettings() {
    return store.get('settings', defaultSettings);
}

function saveSettings(newSettings) {
    store.set('settings', newSettings);
}

function openSettingsWindow() {
    if (settingsWindow) {
        settingsWindow.focus();
        return;
    }

    settingsWindow = new BrowserWindow({
        width: 450,
        height: 500,
        resizable: false,
        minimizable: false,
        maximizable: false,
        title: 'GigaMate Settings',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    settingsWindow.loadFile('settings.html');
    settingsWindow.setMenu(null);

    if (debug) {
        settingsWindow.webContents.openDevTools();
    }

    settingsWindow.on('closed', () => {
        settingsWindow = null;
    });
}

const contextMenu = Menu.buildFromTemplate([
    {label: 'Settings...', type: 'normal', click: openSettingsWindow},
    {type: 'separator'},
    {label: 'Quit', type: 'normal', click: app.quit}
]);

const HID = require('node-hid');
let dev = {};
const properties = {
    "brightness": 0x10,
    "contrast": 0x12,
    "sharpness": 0x87,
    "volume": 0x62,
    "low-blue-light": 0xe00b,
    "kvm-switch": 0xe069,
    "colour-mode": 0xe003,
    "rgb-red": 0xe004,
    "rgb-green": 0xe005,
    "rgb-blue": 0xe006
};

const mb = menubar({
    browserWindow: {
        width: 200,
        height: 160,
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

    // IPC handlers for monitor controls
    ipcMain.on('brightness-change', (event, value) => {
        setProperty('brightness', value);
    });

    ipcMain.on('contrast-change', (event, value) => {
        setProperty('contrast', value);
    });

    ipcMain.on('volume-change', (event, value) => {
        setProperty('volume', value);
    });

    ipcMain.on('kvm-switch-change', (event, value) => {
        setProperty('kvm-switch', value);
        store.set('kvm', value);
    });

    // Send current values to renderer
    ipcMain.on('request-values', (event) => {
        const settings = getSettings();
        event.reply('init-values', {
            brightness: store.get('brightness', settings.defaults.brightness),
            contrast: store.get('contrast', settings.defaults.contrast),
            volume: store.get('volume', settings.defaults.volume),
            kvm: store.get('kvm', 0)
        });
    });

    // Settings IPC handlers
    ipcMain.on('get-settings', (event) => {
        event.reply('settings-data', getSettings());
    });

    ipcMain.on('save-settings', (event, newSettings) => {
        const oldSettings = getSettings();
        saveSettings(newSettings);

        // Apply startup settings
        app.setLoginItemSettings({
            openAtLogin: newSettings.startup.openAtLogin,
            openAsHidden: newSettings.startup.startHidden
        });

        // Re-register shortcuts if changed
        if (JSON.stringify(oldSettings.shortcuts) !== JSON.stringify(newSettings.shortcuts)) {
            globalShortcut.unregisterAll();
            setShortcuts();
        }

        // Restart HTTP server if port changed
        if (oldSettings.api.port !== newSettings.api.port || oldSettings.api.enabled !== newSettings.api.enabled) {
            restartHttpServer();
        }

        event.reply('settings-saved');
    });

    ipcMain.on('capture-shortcut', (event, shortcutName) => {
        // The renderer will handle the actual key capture
        event.reply('start-capture', shortcutName);
    });

    mb.tray.on('right-click', () => {
        mb.tray.popUpContextMenu(contextMenu);
    });

    setShortcuts();

    const settings = getSettings();
    app.setLoginItemSettings({
        openAtLogin: settings.startup.openAtLogin,
        openAsHidden: settings.startup.startHidden
    });

    connectToDevice();
    startHttpServer();
});

function setShortcuts() {
    const settings = getSettings();
    const shortcuts = settings.shortcuts;

    if (shortcuts.brightnessUp) {
        globalShortcut.register(shortcuts.brightnessUp, () => {
            const current = parseInt(store.get('brightness', settings.defaults.brightness));
            setProperty('brightness', Math.min(100, current + 10));
        });
    }

    if (shortcuts.brightnessDown) {
        globalShortcut.register(shortcuts.brightnessDown, () => {
            const current = parseInt(store.get('brightness', settings.defaults.brightness));
            setProperty('brightness', Math.max(0, current - 10));
        });
    }

    if (shortcuts.contrastUp) {
        globalShortcut.register(shortcuts.contrastUp, () => {
            const current = parseInt(store.get('contrast', settings.defaults.contrast));
            setProperty('contrast', Math.min(100, current + 10));
        });
    }

    if (shortcuts.contrastDown) {
        globalShortcut.register(shortcuts.contrastDown, () => {
            const current = parseInt(store.get('contrast', settings.defaults.contrast));
            setProperty('contrast', Math.max(0, current - 10));
        });
    }

    if (shortcuts.volumeUp) {
        globalShortcut.register(shortcuts.volumeUp, () => {
            const current = parseInt(store.get('volume', settings.defaults.volume));
            setProperty('volume', Math.min(100, current + 10));
        });
    }

    if (shortcuts.volumeDown) {
        globalShortcut.register(shortcuts.volumeDown, () => {
            const current = parseInt(store.get('volume', settings.defaults.volume));
            setProperty('volume', Math.max(0, current - 10));
        });
    }
}

// HTTP API
expressApp.use(bodyParser.urlencoded({extended: false}));
expressApp.use(bodyParser.json());

function startHttpServer() {
    const settings = getSettings();
    if (!settings.api.enabled) return;

    httpServer = expressApp.listen(settings.api.port, () => {
        console.log(`Server running on port ${settings.api.port}`);
    });
}

function restartHttpServer() {
    if (httpServer) {
        httpServer.close(() => {
            startHttpServer();
        });
    } else {
        startHttpServer();
    }
}

// GET current monitor settings
expressApp.get('/monitor-settings', (req, res) => {
    const settings = getSettings();
    res.json({
        brightness: store.get('brightness', settings.defaults.brightness),
        contrast: store.get('contrast', settings.defaults.contrast),
        volume: store.get('volume', settings.defaults.volume),
        kvm: store.get('kvm', 0)
    });
});

// POST to update monitor settings
expressApp.post('/monitor-settings', (req, res) => {
    const {brightness, contrast, volume, kvm} = req.body;
    const results = {};
    const errors = [];

    if (brightness !== undefined) {
        const val = parseInt(brightness);
        if (isNaN(val) || val < 0 || val > 100) {
            errors.push('brightness must be 0-100');
        } else {
            setProperty('brightness', val);
            results.brightness = val;
        }
    }

    if (contrast !== undefined) {
        const val = parseInt(contrast);
        if (isNaN(val) || val < 0 || val > 100) {
            errors.push('contrast must be 0-100');
        } else {
            setProperty('contrast', val);
            results.contrast = val;
        }
    }

    if (volume !== undefined) {
        const val = parseInt(volume);
        if (isNaN(val) || val < 0 || val > 100) {
            errors.push('volume must be 0-100');
        } else {
            setProperty('volume', val);
            results.volume = val;
        }
    }

    if (kvm !== undefined) {
        const val = parseInt(kvm);
        if (isNaN(val) || (val !== 0 && val !== 1)) {
            errors.push('kvm must be 0 or 1');
        } else {
            setProperty('kvm-switch', val);
            store.set('kvm', val);
            results.kvm = val;
        }
    }

    if (errors.length > 0) {
        res.status(400).json({errors, applied: results});
    } else {
        res.json({success: true, applied: results});
    }
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
        const devInfo = devices.find(device => device.vendorId === 0x0bda && device.productId === 0x1100);
        dev = new HID.HID(devInfo.path);
    } catch (error) {
        console.error("Error connecting to device:", error);
        setTimeout(connectToDevice, 3000);
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
