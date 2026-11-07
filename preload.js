// Exposes a minimal IPC bridge to the sandboxed, context-isolated renderers.
const {contextBridge, ipcRenderer} = require('electron');

const SEND_CHANNELS = [
    'brightness-change', 'contrast-change', 'volume-change', 'kvm-switch-change',
    'request-values', 'open-settings', 'get-settings', 'save-settings'
];
const RECEIVE_CHANNELS = ['init-values', 'settings-data', 'settings-saved'];

contextBridge.exposeInMainWorld('gigamate', {
    platform: process.platform,
    send(channel, data) {
        if (SEND_CHANNELS.includes(channel)) ipcRenderer.send(channel, data);
    },
    on(channel, callback) {
        if (RECEIVE_CHANNELS.includes(channel)) ipcRenderer.on(channel, (event, data) => callback(data));
    }
});
