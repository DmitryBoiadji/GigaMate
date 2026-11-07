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
let currentKvm = 0;

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

names.forEach(name => {
    const sendValue = throttledSender(`${name}-change`);
    controls[name].addEventListener('input', function() {
        const value = parseInt(this.value, 10);
        render(name, value);
        sendValue(value);
    });
});

kvmSwitch.addEventListener('click', () => {
    currentKvm = currentKvm === 0 ? 1 : 0;
    send('kvm-switch-change', currentKvm);
});

on('init-values', data => {
    names.forEach(name => {
        if (data[name] !== undefined) render(name, data[name]);
    });
    if (data.kvm !== undefined) currentKvm = data.kvm;
});

send('request-values');

document.getElementById('open-settings').addEventListener('click', () => {
    send('open-settings');
});
