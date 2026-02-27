Discovery Browser
=================

Discovery Browser is a unique Electron-based web browser built around a card-style experience instead of a traditional tab bar. Pages can open in floating, movable card windows, making multitasking feel more visual and flexible.

What makes it unique
--------------------
- Card-based browsing UI for a modern, windowed workflow
- Floating card windows with smooth interaction
- Bubble/minimized card behavior for lightweight switching
- Built-in download handling with progress and history support
- External URL handling that routes links directly into cards
- Custom protocol/file association support for Windows packaging

Tech stack
----------
- Electron
- Node.js
- HTML/CSS/JavaScript renderer UI

Project structure (high level)
------------------------------
- main.js: Main process logic, windows, card lifecycle, IPC, downloads
- src/: Frontend pages, styles, and renderer scripts
- preload*.js: Secure bridge scripts for renderer communication
- assets/: App images and icons (including discoverybrowser.ico)
- installer.nsh: NSIS custom installer registry integration

Development
-----------
1. Install dependencies:
   npm install

2. Run app in development:
   npm start

Build (Windows x64)
-------------------
1. Create installer:
   npm run build:win

2. Output:
   Electron Builder generates an NSIS installer in the dist output folder.

Notes
-----
- Windows runtime/installer icon uses: assets/discoverybrowser.ico
- Packaging is managed by electron-builder (NSIS target)
- No Inno Setup is required for standard installer workflows
