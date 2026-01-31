# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GigaMate is an Electron-based desktop tray utility for controlling Gigabyte monitors via HID protocol. It provides brightness control through a tray icon, keyboard shortcuts, and an HTTP REST API for HomeAssistant integration.

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
- HID device communication with Realtek-based Gigabyte monitors (VendorID: 0x0bda, ProductID: 0x1100)
- Express server on port 3000 with POST `/monitor-settings` endpoint
- Global keyboard shortcuts: `Alt+Cmd/Ctrl+Shift+=` (brightness up), `Alt+Cmd/Ctrl+Shift+-` (brightness down)
- Tray icon via `menubar` package
- Settings persistence via `electron-store`

**Renderer Process (index.html):**
- Minimal UI with brightness slider
- IPC communication with main process

**Build Configuration (forge.config.js):**
- Electron Forge handles packaging for macOS, Linux (DEB/RPM/Flatpak), and Windows (Squirrel)
- GitHub publisher integration for releases
- Electron Fuses enabled for security hardening

## HID Protocol

Monitor communication uses a custom 193-byte buffer protocol (reverse-engineered from OSD Sidekick). Key property codes:
- `0x10` - Brightness
- `0x12` - Contrast
- `0x62` - Volume
- `0xe00b` - Low blue light
- `0xe00c` - KVM switch

## Key Dependencies

- `node-hid` - Hardware device communication
- `menubar` - Tray icon wrapper
- `express` - REST API server
- `electron-store` - Persistent settings storage
