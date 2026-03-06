# Discovery Web Browser

**Discovery Web** is a unique Electron-based web browser built around a card-style experience instead of a traditional tab bar. Pages can open in floating, movable card windows, making multitasking feel more visual and flexible.

## About

**Discovery Web** is created and maintained by **Modern Tech**.

## What Makes It Unique

- Card-based browsing UI for a modern, windowed workflow
- Floating card windows with smooth interaction
- Bubble/minimized card behavior for lightweight switching
- Built-in download handling with progress and history support
- External URL handling that routes links directly into cards
- Custom protocol/file association support for Windows packaging

## Tech Stack

- Electron
- Node.js
- HTML/CSS/JavaScript renderer UI

## Project Structure (High Level)

- `main.js`: Main process logic, windows, card lifecycle, IPC, downloads
- `src/`: Frontend pages, styles, and renderer scripts
- `preload*.js`: Secure bridge scripts for renderer communication
- `assets/`: App images and icons (including discoverybrowser.ico)
- `installer.nsh`: NSIS custom installer registry integration

## Features

### Card-Based Browsing
Unlike traditional tab-based browsers, Discovery Web uses a card-based system where each webpage opens in its own floating, movable card window. This allows for a more visual and flexible multitasking experience.

### Bubble Mode
Cards can be minimized into bubble indicators for lightweight switching between multiple browsing contexts without cluttering your workspace.

### Download Management
Built-in download handling with progress tracking and download history support.

### URL Handling
External URL handling routes links directly into cards, making it easy to open links from other applications.

## Development

### Prerequisites

- Node.js (v18 or higher recommended)
- npm (comes with Node.js)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/discovery-web.git
   cd discovery-web
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the app in development mode:
   ```bash
   npm start
   ```
   
   Or alternatively:
   ```bash
   npm run dev
   ```

## Building

### Windows (x64)

1. Create the installer:
   ```bash
   npm run build:win
   ```

2. The output will be generated in the `dist` folder as an NSIS installer.

### macOS

```bash
npm run build:mac
```

### Linux

```bash
npm run build:linux
```

## Notes

- Windows runtime/installer icon uses: `assets/discoverybrowser.ico`
- Packaging is managed by electron-builder (NSIS target for Windows)
- No Inno Setup is required for standard installer workflows

## License

Copyright (c) 2024 Modern Tech

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

---

**Discovery Web** - A unique card-style web browser by Modern Tech
