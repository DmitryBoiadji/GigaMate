# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GigaMate is an Electron-based desktop tray utility for controlling Gigabyte monitors via HID protocol. It provides monitor control through a tray icon and keyboard shortcuts.

## Build & Development Commands

```bash
npm start              # Run development environment
npm run make           # Create platform-specific installers
npm run package        # Package app without installers
npm run pub            # Publish to GitHub (current platform, requires .env)
npm run pub-all        # Publish for macOS, Linux, and Windows
npm run rebuild        # Rebuild native modules for current arch
npm run rebuild:arm64  # Rebuild native modules for ARM64 (Apple Silicon)
```

## Architecture

The application consists of two Electron processes:

**Main Process (main.js):**
- HID device communication with Realtek-based Gigabyte monitors (VendorID: 0x0bda, ProductID: 0x1100), single reconnect loop
- Configurable global shortcuts (defaults: `CommandOrControl+Alt+Up/Down` for brightness, `CommandOrControl+Alt+K` for KVM)
- Tray icon via `menubar` package; the popup window is closed 30 s after hide to free memory and recreated on the next click
- Connection status: node-hid does not detect unplugging, so `refreshConnection()` re-checks presence each time the popup is shown
- Settings persistence via `electron-store`; settings are sanitized in `sanitizeSettings()` on read and on save
- Autostart: LaunchAgent plist on macOS, XDG `.desktop` on Linux, Squirrel `Update.exe` login item on Windows
- Theme: `nativeTheme.themeSource` from the `theme` setting (system/light/dark)

**Renderers (index.html + popup.js, settings.html + settings.js):**
- Sandboxed with `contextIsolation`; they talk to main only through `preload.js` (`window.gigamate.send/on` with a channel allowlist)
- Main also checks the sender of every IPC message (`fromPopup` / `fromSettings`), so each channel only works from its own window
- Strict CSP (`script-src 'self'`): no inline scripts
- macOS look: vibrancy backgrounds, styles follow `prefers-color-scheme`; solid fallback background on Windows/Linux

**Build Configuration (forge.config.js):**
- Electron Forge handles packaging for macOS, Linux (DEB/RPM), and Windows (Squirrel)
- GitHub publisher integration for releases
- Electron Fuses enabled for security hardening
- `packagerConfig.ignore` is an allowlist (`APP_FILES`): add new runtime files there, everything else (e.g. `.env`) stays out of the asar

## HID Protocol

Monitor communication uses a custom 193-byte buffer protocol (reverse-engineered from OSD Sidekick). Key property codes:
- `0x10` - Brightness
- `0x12` - Contrast
- `0x62` - Volume
- `0xe00b` - Low blue light
- `0xe069` - KVM switch

## Key Dependencies

- `node-hid` - Hardware device communication
- `menubar` - Tray icon wrapper
- `electron-store` - Persistent settings storage
