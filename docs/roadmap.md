# Development Roadmap

This roadmap breaks down the development of the application into manageable phases, moving from a foundational web core to cross-platform native deployments.

## Phase 1: The Core Editor Foundation (Web Concept)
**Goal:** Build the ridiculously lightweight text editing engine in an isolated web environment.
- Initialize project with Vite + Vanilla TypeScript (or Svelte for zero-runtime reactivity).
- Integrate **CodeMirror 6** as the core editor framework.
- Strip CodeMirror defaults: remove line numbers, gutters, and active line highlights.
- Implement standard Markdown syntax tokenization.
- Create the core CSS architecture utilizing CSS Variables for extreme customizability (fonts, padding, token colors).
- Develop basic Fullscreen vs. Windowed layout logic (CSS/JS).

## Phase 2: Desktop Integration (macOS & Ubuntu)
**Goal:** Wrap the core editor in Tauri to achieve native desktop functionality with minimal overhead.
- Setup Tauri project (Rust backend).
- Implement local filesystem APIs: File -> Open, File -> Save, Save As.
- Implement native window framing logic:
  - **Windowed Mode:** Minimalist title bar, standard drag/resize capabilities.
  - **Fullscreen Mode:** Completely frameless, OS-level fullscreen API integration.
- Ensure cross-platform build parity between macOS and Ubuntu.

## Phase 3: Gestures & The Hidden Sidebar
**Goal:** Implement the button-less UI and gesture-based navigation.
- Implement global gesture tracking (edge swiping, trackpad scrolling).
- Build the hidden sidebar UI overlay.
- Develop the **Settings View**:
  - Live Theme Editor (adjusting CSS variables on the fly).
  - Typography settings (Font family, size, line-height).
  - Layout settings (Horizontal/Vertical padding in fullscreen).
- Develop the **Recent Files View**:
  - Connect to Tauri's local storage/settings to track recently opened paths.
  - Quick-open functionality.
- Package initial preset themes.

## Phase 4: iPadOS Port
**Goal:** Bring the experience to iPadOS seamlessly.
- Integrate Capacitor or Tauri Mobile into the build pipeline.
- Implement iOS-specific filesystem APIs (Document Picker / Files App integration).
- Adapt gestures for touch interfaces (ensuring swipe-from-edge doesn't conflict with iPadOS system gestures).
- Adjust software keyboard handling to ensure the text remains centered and generously padded without being obscured.

## Phase 5: Polish, Performance & Open Source
**Goal:** Finalize the "Zenith" experience and ensure the "ridiculously lightweight" promise.
- Extensive performance profiling: ensure CPU sits at 0% when idle and memory footprint remains minimal (target < 50MB RAM).
- Refine animations (sidebar sliding, mode switching) for 60/120fps smoothness.
- Final user testing on all three target platforms.
- Prepare documentation and open-source release (if applicable).
