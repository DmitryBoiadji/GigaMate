// Tray popup: sliders and KVM switch. Talks to main only through the preload bridge.
const {send, on, platform} = window.gigamate;

document.documentElement.classList.add(`platform-${platform}`);

const SEND_INTERVAL_MS = 50;
const names = ['brightness', 'contrast', 'volume'];
const controls = {};
const values = {};
names.forEach(name => {
    controls[name] = document.getElementById(name);
    values[name] = document.getElementById(`${name}-value`);
});

const kvmSwitch = document.getElementById('kvm-switch');

// The filled part of the track is drawn from this CSS variable
function render(name, value) {
    controls[name].value = value;
    controls[name].style.setProperty('--value', value);
    values[name].textContent = value;
}

// Dragging fires dozens of input events per second; send at most one per interval, always the latest value
function throttledSender(channel) {
    let timer = null;
    let pending = null;
    return value => {
        pending = value;
        if (timer) return;
        send(channel, pending);
        timer = setInterval(() => {
            if (pending === null) {
                clearInterval(timer);
                timer = null;
                return;
            }
            send(channel, pending);
            pending = null;
        }, SEND_INTERVAL_MS);
        pending = null;
    };
}

// Values pushed by main must not yank the thumb from under the pointer
const dragging = new Set();

names.forEach(name => {
    const sendValue = throttledSender(`${name}-change`);
    controls[name].addEventListener('input', function() {
        const value = parseInt(this.value, 10);
        render(name, value);
        sendValue(value);
    });
    controls[name].addEventListener('pointerdown', () => dragging.add(name));
    // On release send the final value right away instead of waiting for the throttle
    controls[name].addEventListener('change', function() {
        dragging.delete(name);
        send(`${name}-change`, parseInt(this.value, 10));
    });
});
document.addEventListener('pointerup', () => dragging.clear());

// Main owns the KVM state, so the popup cannot drift from shortcut presses or failed writes
kvmSwitch.addEventListener('click', () => {
    send('kvm-toggle');
});

const status = document.getElementById('status');
const statusText = document.getElementById('status-text');

function renderStatus(connected) {
    status.classList.toggle('connected', connected);
    statusText.textContent = connected ? 'Connected' : 'Not connected';
}

on('init-values', data => {
    names.forEach(name => {
        if (Number.isInteger(data[name]) && !dragging.has(name)) render(name, data[name]);
    });
    if (typeof data.connected === 'boolean') renderStatus(data.connected);
});

send('request-values');

document.getElementById('open-settings').addEventListener('click', () => {
    send('open-settings');
});
