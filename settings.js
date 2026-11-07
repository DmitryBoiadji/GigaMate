// Settings window. Talks to main only through the preload bridge.
const {send, on, platform} = window.gigamate;

const isMac = platform === 'darwin';
document.documentElement.classList.add(`platform-${platform}`);

let recordingInput = null;

// DOM elements
const shortcutInputs = {
    brightnessUp: document.getElementById('shortcut-brightnessUp'),
    brightnessDown: document.getElementById('shortcut-brightnessDown'),
    contrastUp: document.getElementById('shortcut-contrastUp'),
    contrastDown: document.getElementById('shortcut-contrastDown'),
    volumeUp: document.getElementById('shortcut-volumeUp'),
    volumeDown: document.getElementById('shortcut-volumeDown'),
    kvmSwitch: document.getElementById('shortcut-kvmSwitch')
};

const elements = {
    openAtLogin: document.getElementById('openAtLogin'),
    defaultBrightness: document.getElementById('defaultBrightness'),
    defaultContrast: document.getElementById('defaultContrast'),
    defaultVolume: document.getElementById('defaultVolume')
};

const themeRadios = document.querySelectorAll('input[name="theme"]');

// Load settings
send('get-settings');

on('settings-data', populateForm);

function populateShortcuts(shortcuts) {
    Object.keys(shortcutInputs).forEach(key => {
        const value = shortcuts[key] || '';
        shortcutInputs[key].dataset.value = value;
        if (shortcutInputs[key] !== recordingInput) shortcutInputs[key].value = formatShortcut(value);
        updateShortcutStyle(shortcutInputs[key]);
    });
}

function populateForm(settings) {
    populateShortcuts(settings.shortcuts);

    const theme = settings.theme || 'system';
    themeRadios.forEach(radio => { radio.checked = radio.value === theme; });

    elements.openAtLogin.checked = settings.startup.openAtLogin;

    elements.defaultBrightness.value = settings.defaults.brightness;
    elements.defaultContrast.value = settings.defaults.contrast;
    elements.defaultVolume.value = settings.defaults.volume;
}

// Human-readable accelerator: macOS key symbols, text names elsewhere
const MAC_SYMBOLS = {
    CommandOrControl: '⌘', Command: '⌘', Cmd: '⌘', Control: '⌃', Ctrl: '⌃',
    Alt: '⌥', Option: '⌥', Shift: '⇧',
    Up: '↑', Down: '↓', Left: '←', Right: '→',
    Space: 'Space', Plus: '+', Enter: '↩', Return: '↩', Backspace: '⌫', Tab: '⇥'
};

function formatShortcut(shortcut) {
    if (!shortcut) return '';
    if (isMac) {
        return shortcut.split('+').map(part => MAC_SYMBOLS[part] || part).join('');
    }
    return shortcut
        .replace('CommandOrControl', 'Ctrl')
        .replace('Command', 'Cmd')
        .replace('Control', 'Ctrl');
}

function updateShortcutStyle(input) {
    input.parentElement.classList.toggle('empty', !input.dataset.value);
}

// Marks recorders whose shortcut is taken by another app
function markFailedShortcuts(failed) {
    Object.keys(shortcutInputs).forEach(key => {
        shortcutInputs[key].parentElement.classList.toggle('failed', failed.includes(key));
    });
}

// Physical key (KeyboardEvent.code) -> Electron accelerator key.
// Uses the physical key so Option+letter on macOS does not produce characters like "å" or "Dead".
const CODE_KEYS = {
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
    Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete',
    Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right'
};

function acceleratorKey(code) {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^Numpad[0-9]$/.test(code)) return 'num' + code.slice(6);
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
    return CODE_KEYS[code] || null;
}

// Shortcut recording: start by click, or by Enter/Space for keyboard users
Object.keys(shortcutInputs).forEach(key => {
    shortcutInputs[key].addEventListener('click', function() {
        if (recordingInput !== this) startRecording(this);
    });
    shortcutInputs[key].addEventListener('keydown', function(e) {
        if (recordingInput || (e.code !== 'Enter' && e.code !== 'Space')) return;
        e.preventDefault();
        startRecording(this);
    });
});

function stopRecording() {
    recordingInput.parentElement.classList.remove('recording');
    recordingInput.value = formatShortcut(recordingInput.dataset.value);
    recordingInput = null;
    send('resume-shortcuts');
}

function startRecording(input) {
    if (recordingInput) stopRecording();

    recordingInput = input;
    input.parentElement.classList.add('recording');
    input.value = 'Type Shortcut';
    // Otherwise a combination that is already registered never reaches this window
    send('pause-shortcuts');
}

document.addEventListener('keydown', (e) => {
    if (!recordingInput) return;
    // Let Tab move focus away instead of being swallowed by the recorder
    if (e.code === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        stopRecording();
        return;
    }

    e.preventDefault();
    e.stopPropagation();

    if (e.code === 'Escape') {
        stopRecording();
        return;
    }

    const key = acceleratorKey(e.code);
    // Modifier-only presses and unsupported keys keep the recorder waiting
    if (!key) return;

    const modifiers = [];
    if (isMac) {
        if (e.metaKey) modifiers.push('Command');
        if (e.ctrlKey) modifiers.push('Control');
    } else {
        if (e.ctrlKey) modifiers.push('CommandOrControl');
        // Windows/Super key; dropping it silently would record a different shortcut
        if (e.metaKey) modifiers.push('Super');
    }
    if (e.altKey) modifiers.push('Alt');
    if (e.shiftKey) modifiers.push('Shift');

    // A global shortcut without a modifier would steal that key system-wide; allow it only for F-keys
    const isFunctionKey = /^F\d+$/.test(key);
    const hasModifier = modifiers.some(m => m !== 'Shift');
    if (!hasModifier && !isFunctionKey) {
        recordingInput.value = isMac ? 'Add ⌘, ⌃ or ⌥' : 'Add Ctrl or Alt';
        return;
    }

    const accelerator = [...modifiers, key].join('+');
    const owner = Object.keys(shortcutInputs).find(name =>
        shortcutInputs[name] !== recordingInput && shortcutInputs[name].dataset.value === accelerator);
    if (owner) {
        recordingInput.value = 'Already in use';
        return;
    }

    recordingInput.dataset.value = accelerator;
    updateShortcutStyle(recordingInput);
    stopRecording();
    autoSave();
});

// Clicking outside a recorder cancels recording
document.addEventListener('mousedown', (e) => {
    if (recordingInput && !e.target.closest('.recorder')) stopRecording();
});

// Clear buttons
document.querySelectorAll('.clear-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const key = btn.dataset.shortcut;
        if (recordingInput === shortcutInputs[key]) stopRecording();
        shortcutInputs[key].dataset.value = '';
        shortcutInputs[key].value = '';
        updateShortcutStyle(shortcutInputs[key]);
        autoSave();
    });
});

// Autosave functionality
let saveTimeout = null;
let resetTimeout = null;
const saveIndicator = document.getElementById('saveIndicator');
const IDLE_TEXT = saveIndicator.textContent;

function showSaveIndicator(text, className) {
    clearTimeout(resetTimeout);
    saveIndicator.textContent = text;
    saveIndicator.className = 'save-indicator ' + className;
    if (className === 'saved') {
        resetTimeout = setTimeout(() => {
            saveIndicator.textContent = IDLE_TEXT;
            saveIndicator.className = 'save-indicator';
        }, 2000);
    }
}

// Clamps the field and writes the value back, so what is shown is what gets saved
function percent(input, fallback) {
    const n = parseInt(input.value, 10);
    const value = Number.isNaN(n) ? fallback : Math.min(100, Math.max(0, n));
    if (String(value) !== input.value) input.value = value;
    return value;
}

function collectSettings() {
    const settings = {
        shortcuts: {},
        startup: {
            openAtLogin: elements.openAtLogin.checked
        },
        defaults: {
            brightness: percent(elements.defaultBrightness, 50),
            contrast: percent(elements.defaultContrast, 50),
            volume: percent(elements.defaultVolume, 50)
        },
        theme: (document.querySelector('input[name="theme"]:checked') || {}).value || 'system'
    };

    Object.keys(shortcutInputs).forEach(key => {
        settings.shortcuts[key] = shortcutInputs[key].dataset.value || '';
    });

    return settings;
}

function saveNow() {
    clearTimeout(saveTimeout);
    saveTimeout = null;
    send('save-settings', collectSettings());
}

function autoSave() {
    showSaveIndicator('Saving…', 'saving');
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveNow, 300);
}

// Closing the window right after a change must not lose it
window.addEventListener('beforeunload', () => {
    if (saveTimeout) saveNow();
});

// Add change listeners for autosave. Number fields save on change (blur or Enter), not on every keystroke.
themeRadios.forEach(radio => radio.addEventListener('change', autoSave));
elements.openAtLogin.addEventListener('change', autoSave);
[elements.defaultBrightness, elements.defaultContrast, elements.defaultVolume].forEach(input => {
    input.addEventListener('change', autoSave);
});

// Main may adjust what was sent (duplicate shortcuts dropped, autostart unavailable), so show its result
on('settings-saved', ({settings, failedShortcuts}) => {
    populateShortcuts(settings.shortcuts);
    elements.openAtLogin.checked = settings.startup.openAtLogin;
    markFailedShortcuts(failedShortcuts);
    if (failedShortcuts.length) {
        showSaveIndicator('Saved, but a shortcut is used by another app', 'error');
    } else {
        showSaveIndicator('Saved', 'saved');
    }
});

on('shortcuts-status', markFailedShortcuts);
