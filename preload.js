// Exposes a minimal IPC bridge to the sandboxed, context-isolated renderers.
const {contextBridge, ipcRenderer} = require('electron');

// Main additionally checks that each channel comes from the window that owns it
const SEND_CHANNELS = [
    'brightness-change', 'contrast-change', 'volume-change', 'kvm-toggle', 'request-values', 'open-settings',
    'get-settings', 'save-settings', 'pause-shortcuts', 'resume-shortcuts'
];
const RECEIVE_CHANNELS = ['init-values', 'settings-data', 'settings-saved', 'shortcuts-status'];

contextBridge.exposeInMainWorld('gigamate', {
    platform: process.platform,
    send(channel, data) {
        if (SEND_CHANNELS.includes(channel)) ipcRenderer.send(channel, data);
    },
    on(channel, callback) {
        if (RECEIVE_CHANNELS.includes(channel)) ipcRenderer.on(channel, (event, data) => callback(data));
    }
});
