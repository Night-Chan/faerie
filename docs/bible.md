# Application Bible

## 1. Vision & Core Philosophy
The core purpose of this application is to provide an ultra-minimalist, distraction-free Markdown editing experience akin to iA Writer, but strictly optimized for low power consumption and high customizability. 

It acts as a digital sanctuary: when you open it, everything else fades away, leaving only you and your text.

### Key Pillars
- **Zero Distractions:** When editing, there is not a single button on the screen.
- **Ridiculously Lightweight:** Minimal CPU and RAM usage. It should consume almost no power when idle.
- **Local First:** Operates directly on the local filesystem using standard Markdown. No proprietary databases.
- **Extreme Customizability:** Every visual aspect (font, background color, markdown token colors) can be adjusted to fit the user's perfect aesthetic.
- **Cross-Platform Parity:** Must provide a consistent experience across Ubuntu, macOS, and iPadOS.

---

## 2. Modes of Operation

### Fullscreen Mode
- **Visuals:** The app fills the entire screen. A completely blank background.
- **Layout:** Text is centered in the middle of the screen with generous, adjustable padding on the sides.
- **Typography:** Decently large, highly readable font sizes (fully adjustable).

### Windowed Mode
- **Visuals:** Functions as a traditional desktop window but remains incredibly minimalist.
- **Layout:** No line numbers, no gutters, no traditional toolbars.
- **Integration:** Blends cleanly with the host OS's window manager while retaining the distraction-free ethos.

---

## 3. User Interface & Interaction

### The Hidden Sidebar
- Since there are no on-screen buttons, all navigation and configuration live in a hidden sidebar.
- **Trigger:** Appeared by "swiping heavily from the side" (trackpad/touch) or moving the cursor to the extreme edge.
- **Contents:**
  - **Recent Files:** A clean list of recently opened local Markdown files.
  - **Settings:** Controls for themes, typography, and padding.

### Markdown Rendering
- Standard Markdown formatting.
- Syntax highlighting should be elegant and subtle, fully dictated by the active theme.
- No WYSIWYG hiding of markdown characters; the user sees the raw text and markdown syntax, styled beautifully.

---

## 4. Technical Approach

To achieve the "ridiculously lightweight" requirement across macOS, Ubuntu, and iPadOS, we cannot use heavy frameworks like Electron.

**Proposed Stack:**
- **Editor Engine:** **CodeMirror 6** 
  - Why: Open source, extremely lightweight, modular, and built for modern web standards. It's highly customizable and handles Markdown syntax tokenization efficiently.
- **Desktop Shell (macOS & Ubuntu):** **Tauri** (Rust)
  - Why: Tauri uses the OS's native webview (WebKit on Mac, WebKitGTK on Ubuntu) instead of bundling Chromium. This results in binaries under 10MB and drastically lower RAM/CPU usage.
- **Mobile Shell (iPadOS):** **Capacitor** or **Tauri Mobile**
  - Why: Wraps the same web core in iOS's native WKWebView. Allows for native filesystem access (Files app integration) and touch gestures.
- **Frontend Framework:** Vanilla TypeScript or ultra-lightweight UI library (e.g., Svelte or Vite/Vanilla).

---

## 5. Theming & Customization
- The app will ship with several "Cool Preset Themes" (e.g., Solarized, Nord, High Contrast Dark, Warm Paper).
- Users will have access to a theme builder in the sidebar to define:
  - Background color
  - Caret color
  - Base text color
  - Specific colors for bold, italics, headings, links, and code blocks.
  - Font families (including custom loaded local fonts).
