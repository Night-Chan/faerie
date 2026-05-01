import { EditorState } from "@codemirror/state";
import { EditorView, ViewPlugin, Decoration, DecorationSet } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxHighlighting, HighlightStyle, syntaxTree } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import { convertFileSrc } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

const faerieHighlightStyle = HighlightStyle.define([
  { tag: t.heading1, class: "cm-heading cm-heading1" },
  { tag: t.heading2, class: "cm-heading cm-heading2" },
  { tag: t.heading3, class: "cm-heading cm-heading3" },
  { tag: t.heading4, class: "cm-heading cm-heading4" },
  { tag: t.heading5, class: "cm-heading cm-heading5" },
  { tag: t.heading6, class: "cm-heading cm-heading6" },
  { tag: t.strong, class: "cm-strong" },
  { tag: t.emphasis, class: "cm-em" },
  { tag: t.link, class: "cm-link" },
  { tag: t.url, class: "cm-link" },
  { tag: t.monospace, class: "cm-inlineCode" },
  { tag: t.comment, color: "#888", fontStyle: "italic" }
]);

let editorView: EditorView | null = null;
let currentFilePath: string | null = null;

// Splash overlay - shown only on first launch, dismissed on click
function showSplashOverlay() {
  const wrapper = document.getElementById("editor-wrapper");
  if (!wrapper) return;
  const splash = document.createElement("div");
  splash.className = "faerie-splash-overlay";
  splash.innerHTML = `
    <p>hey!</p>
    <h1><span class="faerie-syntax-mark">#</span> Welcome to Faerie!</h1>
    <p><span class="faerie-syntax-mark">_</span><span class="faerie-under-em">lightweight, distraction free markdown editor</span><span class="faerie-syntax-mark">_</span></p>
    <p><span class="faerie-syntax-mark">*</span><span class="faerie-ast-em">start typing...</span><span class="faerie-syntax-mark">*</span></p>
  `;
  wrapper.appendChild(splash);
  const dismiss = () => {
    splash.remove();
    editorView?.focus();
  };
  splash.addEventListener("click", dismiss);
  // Also dismiss on any keypress
  const keyDismiss = () => { dismiss(); document.removeEventListener("keydown", keyDismiss); };
  document.addEventListener("keydown", keyDismiss);
}

// Custom Zed-like Markdown Formatter Plugin
const astEmDeco = Decoration.mark({ class: "faerie-ast-em" });
const underEmDeco = Decoration.mark({ class: "faerie-under-em" });
const markDeco = Decoration.mark({ class: "faerie-syntax-mark" });

const faerieMarkdownStyler = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = this.buildDeco(view); }
  update(update: any) {
    if (update.docChanged || update.viewportChanged || update.syntaxTreeAvailable) {
      this.decorations = this.buildDeco(update.view);
    }
  }
  buildDeco(view: EditorView) {
    const decos: {from: number, to: number, deco: Decoration}[] = [];
    for (let {from, to} of view.visibleRanges) {
      syntaxTree(view.state).iterate({
        from, to,
        enter(node) {
          if (node.name === "Emphasis") {
            const text = view.state.sliceDoc(node.from, node.from + 1);
            if (text === "*") decos.push({from: node.from, to: node.to, deco: astEmDeco});
            else if (text === "_") decos.push({from: node.from, to: node.to, deco: underEmDeco});
          }
          if (node.name === "EmphasisMark" || node.name === "StrongEmphasisMark") {
            decos.push({from: node.from, to: node.to, deco: markDeco});
          }
        }
      });
    }
    decos.sort((a, b) => a.from - b.from || a.to - b.to);
    return Decoration.set(decos.map(d => d.deco.range(d.from, d.to)), true);
  }
}, { decorations: v => v.decorations });

const headerAutoSpacer = EditorState.transactionFilter.of(tr => {
  if (tr.docChanged && tr.isUserEvent("input.type")) {
    let changed = false;
    let changes: any[] = [];
    let newAnchor = tr.selection?.main.anchor || 0;

    tr.changes.iterChanges((fromA, toA, _fromB, toB, inserted) => {
      const text = inserted.toString();
      const lineText = tr.startState.doc.lineAt(fromA).text;
      const textBefore = lineText.slice(0, fromA - tr.startState.doc.lineAt(fromA).from);
      const charAfter = tr.startState.doc.sliceString(fromA, fromA + 1);

      if (text === "#") {
        if (textBefore === "" || /^#+$/.test(textBefore)) {
          changes.push({from: fromA, to: toA, insert: "# "});
          changed = true;
          if (newAnchor === toB) newAnchor = fromA + 2; 
        } else if (/^#+ $/.test(textBefore)) {
          changes.push({from: fromA - 1, to: toA, insert: "# "});
          changed = true;
          if (newAnchor === toB) newAnchor = fromA + 1;
        }
      } else if (text === " ") {
        if (/^#+ $/.test(textBefore)) {
          changes.push({from: fromA, to: toA, insert: ""});
          changed = true;
          if (newAnchor === toB) newAnchor = fromA; 
        }
      }

      // Auto-close syntax characters
      const closePairs: Record<string, string> = { "*": "*", "_": "_", "`": "`", "[": "]" };
      if (closePairs[text]) {
        const closeChar = closePairs[text];
        // Skip-over: if the char after cursor is already the closing char
        if (charAfter === closeChar && text !== "[") {
          changes.push({from: fromA, to: fromA + 1, insert: ""});
          changed = true;
          if (newAnchor === toB) newAnchor = fromA + 1;
        }
        // Auto-insert: only if NOT inside a word (char before is empty/space/punctuation)
        else {
          const charBefore = textBefore.slice(-1);
          const isInsideWord = charBefore !== "" && /\w/.test(charBefore);
          if (!isInsideWord) {
            changes.push({from: fromA, to: toA, insert: text + closeChar});
            changed = true;
            if (newAnchor === toB) newAnchor = fromA + 1;
          }
        }
      }
    });

    if (changed) {
      return { changes, selection: {anchor: newAnchor} };
    }
  }
  return tr;
});

// Tab key handler - keep focus in editor
const tabHandler = EditorView.domEventHandlers({
  keydown(event: KeyboardEvent, view: EditorView) {
    if (event.key === "Tab") {
      event.preventDefault();
      const cursor = view.state.selection.main.head;
      view.dispatch({
        changes: {from: cursor, insert: "  "},
        selection: {anchor: cursor + 2}
      });
      return true;
    }
    return false;
  }
});

let isEditingSettings = false;
let previousDocContent = "";

const updateListener = EditorView.updateListener.of((update) => {
  if (update.docChanged && editorWrapper) {
    if (update.state.doc.length === 0) editorWrapper.classList.add("is-empty");
    else editorWrapper.classList.remove("is-empty");

    if (isEditingSettings) {
      try {
        const text = update.state.doc.toString();
        if (text.trim() === "") {
          if (!["faerie-light", "faerie-dark", "nord", "solarized"].includes(currentTheme)) {
            const saved = JSON.parse(localStorage.getItem("savedThemes") || "{}");
            delete saved[currentTheme];
            localStorage.setItem("savedThemes", JSON.stringify(saved));
            populateThemeDropdown();
            currentTheme = "faerie-light";
            applyThemePreview("faerie-light");
          }
          document.getElementById("btn-edit-json")?.click();
          return;
        }

        const settings = JSON.parse(text);
        if (settings.colors) {
          applyCustomCSSVars(settings.colors);
          Object.assign(customVars, settings.colors);
        }
        
        if (settings.name && settings.name !== currentTheme) {
          // Only update the name in memory for live preview; 
          // actual save to localStorage happens on Ctrl+S exit
          currentTheme = settings.name;
          const sel = document.getElementById("theme-selected");
          if (sel) sel.textContent = settings.name;
        }

        if (settings.font) {
          currentFont = settings.font;
          applyFontPreview(settings.font);
          const sel = document.getElementById("font-selected");
          if (sel) sel.textContent = settings.font;
        }
        if (settings.paddingX !== undefined) {
          (document.getElementById("padding-x-slider") as HTMLInputElement).value = settings.paddingX;
          document.documentElement.style.setProperty("--editor-padding-x", `${settings.paddingX}px`);
        }
        if (settings.paddingY !== undefined) {
          (document.getElementById("padding-y-slider") as HTMLInputElement).value = settings.paddingY;
          document.documentElement.style.setProperty("--editor-padding-y", `${settings.paddingY}px`);
        }
        if (settings.fontSize !== undefined) {
          (document.getElementById("fontsize-slider") as HTMLInputElement).value = settings.fontSize;
          document.documentElement.style.setProperty("--font-size", `${settings.fontSize}px`);
        }
      } catch(e) {}
    }
  }
});

const editorWrapper = document.getElementById("editor-wrapper");
if (editorWrapper) {
  editorWrapper.classList.add("is-empty");
  const startState = EditorState.create({
    doc: "",
    extensions: [
      markdown(),
      syntaxHighlighting(faerieHighlightStyle),
      faerieMarkdownStyler,
      headerAutoSpacer,
      tabHandler,
      EditorView.lineWrapping,
      updateListener,
      EditorView.theme({
        "&": { outline: "none" },
        ".cm-scroller": { overflow: "auto" }
      })
    ]
  });

  editorView = new EditorView({
    state: startState,
    parent: editorWrapper
  });

  // Show splash only on initial launch
  showSplashOverlay();
}

// File Operations Logic
async function openFile() {
  try {
    const file = await open({
      multiple: false,
      filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }]
    });
    
    if (file && typeof file === "string") {
      const content = await readTextFile(file);
      if (editorView) {
        editorView.dispatch({
          changes: { from: 0, to: editorView.state.doc.length, insert: content }
        });
      }
      currentFilePath = file;
      updateRecentFiles(file);
      closeSidebar();
    }
  } catch (error) {
    console.error("Failed to open file:", error);
  }
}

async function saveFile() {
  try {
    let pathToSave = currentFilePath;
    if (!pathToSave) {
      const file = await save({
        filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }]
      });
      if (file) {
        pathToSave = file;
        currentFilePath = file;
      } else {
        return;
      }
    }
    
    if (editorView && pathToSave) {
      const content = editorView.state.doc.toString();
      await writeTextFile(pathToSave, content);
      updateRecentFiles(pathToSave);
      closeSidebar();
    }
  } catch (error) {
    console.error("Failed to save file:", error);
  }
}

async function saveFileAs() {
  try {
    const file = await save({
      filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }]
    });
    if (file) {
      if (editorView) {
        const content = editorView.state.doc.toString();
        await writeTextFile(file, content);
        currentFilePath = file;
        updateRecentFiles(file);
        closeSidebar();
      }
    }
  } catch (error) {
    console.error("Failed to save file as:", error);
  }
}

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    if (isEditingSettings) {
      document.getElementById("btn-edit-json")?.click();
    } else {
      saveFile();
    }
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
    e.preventDefault();
    new WebviewWindow(`faerie-${Date.now()}`, { url: "index.html", title: "Faerie", x: 80, y: 80 });
  }
});

// OS Specific Logic
const isMac = navigator.userAgent.includes("Mac");
if (isMac) {
  const fileActions = document.getElementById("file-actions");
  if (fileActions) fileActions.style.display = "none";
  setupMacMenu();
} else {
  const btnOpenFile = document.getElementById("btn-open-file");
  const btnSaveFile = document.getElementById("btn-save-file");
  btnOpenFile?.addEventListener("click", openFile);
  btnSaveFile?.addEventListener("click", saveFile);
}

async function setupMacMenu() {
  try {
    const newItem = await MenuItem.new({ text: "New Window", action: () => {
      new WebviewWindow(`faerie-${Date.now()}`, { url: "index.html", title: "Faerie", x: 80, y: 80 });
    }, accelerator: "CmdOrCtrl+N" });
    const openItem = await MenuItem.new({ text: "Open...", action: openFile, accelerator: "CmdOrCtrl+O" });
    const saveItem = await MenuItem.new({ text: "Save", action: saveFile, accelerator: "CmdOrCtrl+S" });
    const saveAsItem = await MenuItem.new({ text: "Save As...", action: saveFileAs, accelerator: "Shift+CmdOrCtrl+S" });
    const fileMenu = await Submenu.new({ text: "File", items: [newItem, openItem, saveItem, saveAsItem] });
    
    const editMenu = await Submenu.new({
      text: "Edit",
      items: [
        await PredefinedMenuItem.new({ item: "Undo" }),
        await PredefinedMenuItem.new({ item: "Redo" }),
        await PredefinedMenuItem.new({ item: "Separator" }),
        await PredefinedMenuItem.new({ item: "Cut" }),
        await PredefinedMenuItem.new({ item: "Copy" }),
        await PredefinedMenuItem.new({ item: "Paste" }),
        await PredefinedMenuItem.new({ item: "SelectAll" }),
      ]
    });
    
    const menu = await Menu.new({
      items: [
        await Submenu.new({ text: "Faerie", items: [await PredefinedMenuItem.new({ item: "Quit" })] }),
        fileMenu,
        editMenu
      ]
    });
    await menu.setAsAppMenu();
  } catch (e) {
    console.error("Failed to setup menu:", e);
  }
}

// State & UI tracking
const sidebar = document.getElementById("sidebar");
const sidebarSlider = document.getElementById("sidebar-slider");
const edgeTrigger = document.querySelector(".edge-trigger");

let sidebarOpen = false;
let pinSidebar = false;
let currentPane = "main";
let activeInteractingElement: HTMLElement | null = null; // for selective fade

function openSidebar() {
  sidebar?.classList.add("open");
  sidebarOpen = true;
}

function closeSidebar() {
  sidebar?.classList.remove("open");
  sidebarOpen = false;
  activeInteractingElement = null;
  // Delay sliding panes back to main so it doesn't look weird while closing
  setTimeout(() => {
    sidebarSlider?.classList.remove("show-settings", "show-theme");
    currentPane = "main";
  }, 300);
}

edgeTrigger?.addEventListener("mouseenter", openSidebar);

// Sticky Pin logic
const btnPin = document.getElementById("btn-pin");
btnPin?.addEventListener("click", () => {
  pinSidebar = !pinSidebar;
  if (pinSidebar) btnPin.classList.add("active");
  else btnPin.classList.remove("active");
});

// Smart hover-to-close with buffer
document.addEventListener("mousemove", (e) => {
  if (!sidebarOpen || pinSidebar) return;
  const sidebarRect = sidebar?.getBoundingClientRect();
  if (!sidebarRect) return;
  
  const buffer = currentPane === "main" ? 15 : 50;
  const rightBound = 260 + buffer; // Hardcoded hit-box to avoid closing during open transition
  
  if (
    e.clientX > rightBound ||
    e.clientY < sidebarRect.top - buffer ||
    e.clientY > sidebarRect.bottom + buffer ||
    e.clientX < sidebarRect.left - buffer
  ) {
    closeSidebar();
  }
});

let isMouseDown = false;
document.addEventListener("mousedown", () => isMouseDown = true);
document.addEventListener("mouseup", () => {
  isMouseDown = false;
  sidebar?.classList.remove("intersect-fade");
  document.querySelectorAll(".active-element").forEach(el => el.classList.remove("active-element"));
});

// Intersect Fading & Selective Opacity
document.addEventListener("mousemove", () => {
  if (sidebarOpen && activeInteractingElement && isMouseDown) {
    const maxWidthStr = getComputedStyle(document.documentElement).getPropertyValue("--editor-max-width");
    const padStr = getComputedStyle(document.documentElement).getPropertyValue("--editor-padding-x");
    const maxWidth = parseInt(maxWidthStr) || 800;
    const paddingX = parseInt(padStr) || 40;
    
    const textLeft = (window.innerWidth / 2) - (maxWidth / 2) + paddingX;
    
    if (textLeft < 260) {
      sidebar?.classList.add("intersect-fade");
      activeInteractingElement.classList.add("active-element");
      if (activeInteractingElement === pickerModal && activeColorField) {
        document.getElementById(`row-${activeColorField}`)?.classList.add("active-element");
      }
    } else {
      sidebar?.classList.remove("intersect-fade");
      activeInteractingElement.classList.remove("active-element");
      if (activeColorField) document.getElementById(`row-${activeColorField}`)?.classList.remove("active-element");
    }
  } else if (!isMouseDown) {
    sidebar?.classList.remove("intersect-fade");
    document.querySelectorAll(".active-element").forEach(el => el.classList.remove("active-element"));
  }
});

// Navigation
document.getElementById("btn-settings")?.addEventListener("click", () => {
  sidebarSlider?.classList.add("show-settings");
  currentPane = "settings";
});
document.getElementById("btn-back-main")?.addEventListener("click", () => {
  sidebarSlider?.classList.remove("show-settings", "show-theme");
  currentPane = "main";
});
document.getElementById("btn-open-font-loader")?.addEventListener("click", () => {
  sidebarSlider?.classList.add("show-font");
  currentPane = "font";
});
document.getElementById("btn-back-settings-from-font")?.addEventListener("click", () => {
  sidebarSlider?.classList.remove("show-font");
  currentPane = "settings";
});
document.getElementById("btn-open-theme-builder")?.addEventListener("click", () => {
  sidebarSlider?.classList.add("show-theme");
  currentPane = "theme";
  document.getElementById("theme-builder-title")!.textContent = `Edit Theme (${currentTheme})`;
  
  const computed = getComputedStyle(document.documentElement);
  themeFields.forEach(f => {
    customVars[f.id] = computed.getPropertyValue(f.id).trim();
  });
  renderThemeBuilder();
});
document.getElementById("btn-back-settings-from-theme")?.addEventListener("click", () => {
  sidebarSlider?.classList.remove("show-theme");
  currentPane = "settings";
  activeInteractingElement = null; // stop fading if any
});

// Live Preview State Manager
let currentTheme = "light";
function applyThemePreview(val: string) {
  // Save layout values before any reset
  const padX = (document.getElementById("padding-x-slider") as HTMLInputElement)?.value || "60";
  const padY = (document.getElementById("padding-y-slider") as HTMLInputElement)?.value || "60";
  const fs = (document.getElementById("fontsize-slider") as HTMLInputElement)?.value || "18";
  const fontFam = document.documentElement.style.getPropertyValue("--font-family");

  const saved = JSON.parse(localStorage.getItem("savedThemes") || "{}");
  if (saved[val]) {
    applyCustomCSSVars(saved[val]);
  } else {
    document.documentElement.setAttribute("data-theme", val);
    document.documentElement.style.cssText = "";
  }

  // Always restore layout values — they are independent of color themes
  document.documentElement.style.setProperty("--editor-padding-x", `${padX}px`);
  document.documentElement.style.setProperty("--editor-padding-y", `${padY}px`);
  document.documentElement.style.setProperty("--font-size", `${fs}px`);
  if (fontFam) document.documentElement.style.setProperty("--font-family", fontFam);
}
function revertThemePreview() { applyThemePreview(currentTheme); }

function applyCustomCSSVars(vars: Record<string, string>) {
  document.documentElement.removeAttribute("data-theme");
  Object.entries(vars).forEach(([k, v]) => document.documentElement.style.setProperty(k, v));
}

// Custom Dropdown Logic
function setupDropdown(dropdownId: string, selectedId: string, optionsId: string, onPreview: (val: string) => void, onSelect: (val: string) => void) {
  const dropdown = document.getElementById(dropdownId);
  const selected = document.getElementById(selectedId);
  const options = document.getElementById(optionsId);
  const parentGroup = dropdown?.closest('.settings-group') as HTMLElement;

  selected?.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdown?.classList.toggle("open");
    if (dropdown?.classList.contains("open")) {
      activeInteractingElement = parentGroup; // mark for selective fade
    } else {
      activeInteractingElement = null;
    }
  });

  options?.addEventListener("mouseover", (e) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "DIV") {
      const val = target.getAttribute("data-value");
      if (val) onPreview(val);
    }
  });
  
  options?.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "DIV") {
      e.stopPropagation();
      const val = target.getAttribute("data-value");
      const text = target.textContent;
      if (val && text && selected) {
        selected.textContent = text;
        onSelect(val);
      }
      dropdown?.classList.remove("open");
      activeInteractingElement = null;
    }
  });

  options?.addEventListener("mouseleave", () => revertThemePreview());

  document.addEventListener("click", (e) => {
    if (dropdown && !dropdown.contains(e.target as Node)) {
      dropdown.classList.remove("open");
      if (activeInteractingElement === parentGroup) activeInteractingElement = null;
    }
  });
}

function populateThemeDropdown() {
  const options = document.getElementById("theme-options");
  if (!options) return;
  const savedThemes = JSON.parse(localStorage.getItem("savedThemes") || "{}");
  let html = `
    <div data-value="faerie-light">Faerie Light</div>
    <div data-value="faerie-dark">Faerie Dark</div>
    <div data-value="nord">Nord</div>
    <div data-value="solarized">Solarized Dark</div>
  `;
  const builtins = ["light", "dark", "nord", "solarized", "faerie-light", "faerie-dark"];
  Object.keys(savedThemes).forEach(name => {
    if (!builtins.includes(name)) {
      html += `<div data-value="${name}">${name}</div>`;
    }
  });
  options.innerHTML = html;
}

populateThemeDropdown();

setupDropdown("theme-dropdown", "theme-selected", "theme-options", 
  (val) => { applyThemePreview(val); },
  (val) => { 
    currentTheme = val;
    applyThemePreview(val);
    localStorage.setItem("userTheme", val);
  }
);

let currentFont = "JetBrains Mono";
function applyFontPreview(val: string) {
  if (val === "System") {
    document.documentElement.style.setProperty("--font-family", "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif");
  } else {
    // Load from Google Fonts if not already loaded
    const existing = document.querySelector(`link[data-font="${val}"]`);
    if (!existing && val !== "JetBrains Mono") {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.setAttribute("data-font", val);
      link.href = `https://fonts.googleapis.com/css2?family=${val.replace(/\s+/g, '+')}&display=swap`;
      document.head.appendChild(link);
    }
    document.documentElement.style.setProperty("--font-family", `"${val}", monospace`);
  }
}
setupDropdown("font-dropdown", "font-selected", "font-options", 
  (val) => { applyFontPreview(val); },
  (val) => { currentFont = val; applyFontPreview(val); }
);

// Layout sliders (with selective fade hooks)
const padXSlider = document.getElementById("padding-x-slider") as HTMLInputElement;
const padYSlider = document.getElementById("padding-y-slider") as HTMLInputElement;
const fsSlider = document.getElementById("fontsize-slider") as HTMLInputElement;

[padXSlider, padYSlider, fsSlider].forEach(slider => {
  slider?.addEventListener("mousedown", () => {
    activeInteractingElement = slider.closest('.settings-group') as HTMLElement;
  });
  document.addEventListener("mouseup", () => {
    if (activeInteractingElement === slider?.closest('.settings-group')) {
      activeInteractingElement = null;
    }
  });
});

padXSlider?.addEventListener("input", () => document.documentElement.style.setProperty("--editor-padding-x", `${padXSlider.value}px`));
padYSlider?.addEventListener("input", () => document.documentElement.style.setProperty("--editor-padding-y", `${padYSlider.value}px`));
fsSlider?.addEventListener("input", () => document.documentElement.style.setProperty("--font-size", `${fsSlider.value}px`));

document.getElementById("btn-load-local-font")?.addEventListener("click", async () => {
  try {
    const file = await open({
      multiple: false,
      filters: [{ name: "Fonts", extensions: ["ttf", "otf", "woff", "woff2"] }]
    });
    if (file && typeof file === "string") {
      const assetUrl = convertFileSrc(file);
      const fontName = file.split(/[/\\]/).pop()?.split('.')[0] || "CustomLocalFont";
      const newStyle = document.createElement('style');
      newStyle.appendChild(document.createTextNode(`@font-face { font-family: "${fontName}"; src: url("${assetUrl}"); }`));
      document.head.appendChild(newStyle);
      applyFontPreview(fontName);
      currentFont = fontName;
      const sel = document.getElementById("font-selected");
      if(sel) sel.textContent = fontName;
    }
  } catch (e) { console.error(e); }
});

// Recent Files
function updateRecentFiles(path: string) {
  let recents = JSON.parse(localStorage.getItem("recentFiles") || "[]") as string[];
  recents = recents.filter(p => p !== path);
  recents.unshift(path);
  if (recents.length > 5) recents.pop();
  localStorage.setItem("recentFiles", JSON.stringify(recents));
  renderRecentFiles();
}

function renderRecentFiles() {
  const list = document.getElementById("recent-files");
  if (!list) return;
  const recents = JSON.parse(localStorage.getItem("recentFiles") || "[]") as string[];
  if (recents.length === 0) {
    list.innerHTML = `<li class="empty-state">No recent files</li>`;
    return;
  }
  list.innerHTML = "";
  recents.forEach(path => {
    const li = document.createElement("li");
    li.textContent = path.split(/[/\\]/).pop() || path;
    li.title = path;
    li.addEventListener("click", async () => {
      try {
        const content = await readTextFile(path);
        if (editorView) editorView.dispatch({ changes: { from: 0, to: editorView.state.doc.length, insert: content }});
        currentFilePath = path;
        updateRecentFiles(path);
        closeSidebar();
      } catch (e) { console.error(e); }
    });
    list.appendChild(li);
  });
}
renderRecentFiles();

// ============================================
// THEME BUILDER OVERHAUL
// ============================================
let customVars = JSON.parse(localStorage.getItem("customTheme") || "{}") as Record<string, string>;

const themeFields = [
  { id: "--bg-color", label: "Background" },
  { id: "--text-color", label: "Base Text" },
  { id: "--md-heading", label: "Headings" },
  { id: "--md-bold", label: "Bold Text" },
  { id: "--md-italic", label: "Italic Text" },
  { id: "--md-code", label: "Inline Code" }
];

const pickerModal = document.createElement("div");
pickerModal.className = "inline-color-picker fade-target";
pickerModal.innerHTML = `
  <canvas id="color-wheel" width="160" height="160"></canvas>
  <div class="hex-input-wrapper">
    <span>#</span>
    <input type="text" id="hex-input" maxlength="6" />
  </div>
  <input type="range" id="brightness-slider" min="0" max="100" value="100" class="styled-slider" />
  <div class="color-suggestions" id="color-suggestions"></div>
`;

let activeColorField: string | null = null;
let pickerCtx: CanvasRenderingContext2D | null = null;

function hsvToRgb(h: number, s: number, v: number) {
  let r=0, g=0, b=0, i, f, p, q, t;
  i = Math.floor(h * 6); f = h * 6 - i; p = v * (1 - s); q = v * (1 - f * s); t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: r = v, g = t, b = p; break;
    case 1: r = q, g = v, b = p; break;
    case 2: r = p, g = v, b = t; break;
    case 3: r = p, g = q, b = v; break;
    case 4: r = t, g = p, b = v; break;
    case 5: r = v, g = p, b = q; break;
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}
function rgbToHex(r: number, g: number, b: number) { return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1); }
function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)] : [0,0,0];
}

function renderThemeBuilder() {
  const listContainer = document.getElementById("theme-field-list");
  if (!listContainer) return;
  listContainer.innerHTML = "";
  
  // ensure customVars has defaults if empty
  if (Object.keys(customVars).length === 0) {
    const style = getComputedStyle(document.documentElement);
    themeFields.forEach(f => customVars[f.id] = style.getPropertyValue(f.id).trim());
  }
  
  themeFields.forEach(field => {
    const row = document.createElement("div");
    row.className = "theme-field-row";
    row.id = `row-${field.id}`;
    row.innerHTML = `<span>${field.label}</span><div class="theme-swatch" id="swatch-${field.id}" style="background-color: ${customVars[field.id]}"></div>`;
    
    row.querySelector(".theme-swatch")?.addEventListener("click", () => {
      if (activeColorField === field.id && pickerModal.classList.contains("open")) {
        pickerModal.classList.remove("open");
        activeColorField = null;
        activeInteractingElement = null; // stop fading
      } else {
        row.after(pickerModal);
        pickerModal.classList.add("open");
        activeColorField = field.id;
        activeInteractingElement = pickerModal; // trigger selective fade for picker
        initColorWheel(); // re-draw
      }
    });
    listContainer.appendChild(row);
  });
}

function initColorWheel() {
  const canvas = document.getElementById("color-wheel") as HTMLCanvasElement;
  pickerCtx = canvas.getContext("2d");
  const radius = canvas.width / 2;
  const slider = document.getElementById("brightness-slider") as HTMLInputElement;
  const hexInput = document.getElementById("hex-input") as HTMLInputElement;
  
  function drawWheel() {
    const v = parseInt(slider.value) / 100;
    const imageData = pickerCtx!.createImageData(canvas.width, canvas.height);
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const dx = x - radius;
        const dy = y - radius;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist <= radius) {
          const angle = Math.atan2(dy, dx);
          const hue = (angle + Math.PI) / (Math.PI * 2);
          const sat = dist / radius;
          const [r,g,b] = hsvToRgb(hue < 0 ? hue + 1 : hue, sat, v);
          const idx = (y * canvas.width + x) * 4;
          imageData.data[idx] = r;
          imageData.data[idx+1] = g;
          imageData.data[idx+2] = b;
          imageData.data[idx+3] = 255;
        }
      }
    }
    pickerCtx!.putImageData(imageData, 0, 0);
  }
  
  drawWheel();
  
  let lastX = radius, lastY = radius;
  function pickColor(x: number, y: number) {
    lastX = x; lastY = y;
    const pixel = pickerCtx!.getImageData(x, y, 1, 1).data;
    if (pixel[3] === 0) return;
    const hex = rgbToHex(pixel[0], pixel[1], pixel[2]);
    applyColorToActive(hex);
    if (document.activeElement !== hexInput) hexInput.value = hex.toUpperCase();
  }
  
  hexInput.addEventListener("input", () => {
    let val = hexInput.value.replace(/[^0-9A-Fa-f]/g, "");
    if (val.length === 6) {
      applyColorToActive("#" + val.toLowerCase());
    }
  });
  
  let isDraggingWheel = false;
  canvas.onmousedown = (e) => {
    isDraggingWheel = true;
    activeInteractingElement = pickerModal;
    isMouseDown = true;
    const rect = canvas.getBoundingClientRect();
    pickColor(e.clientX - rect.left, e.clientY - rect.top);

    const onMove = (ev: MouseEvent) => {
      if (!isDraggingWheel) return;
      const r = canvas.getBoundingClientRect();
      pickColor(ev.clientX - r.left, ev.clientY - r.top);
    };
    const onUp = () => {
      isDraggingWheel = false;
      isMouseDown = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  slider.removeEventListener("input", drawWheel);
  slider.addEventListener("input", () => {
    drawWheel();
    pickColor(lastX, lastY);
  });
  
  // Smart Dynamic Suggestions
  const bgStr = customVars["--bg-color"] || "#ffffff";
  const textStr = customVars["--text-color"] || "#333333";
  const bg = hexToRgb(bgStr);
  const txt = hexToRgb(textStr);
  
  const container = document.getElementById("color-suggestions");
  if (container) {
    container.innerHTML = "";
    // provide bg, text, a complement of bg, and analogous of text
    const hexes = [
      bgStr, textStr,
      rgbToHex(255-bg[0], 255-bg[1], 255-bg[2]),
      rgbToHex(Math.min(255, txt[0]+60), Math.max(0, txt[1]-40), txt[2])
    ];
    // filter duplicates
    const uniqueHexes = [...new Set(hexes)];
    
    uniqueHexes.forEach(hex => {
      const swatch = document.createElement("div");
      swatch.className = "color-swatch";
      swatch.style.backgroundColor = hex;
      swatch.addEventListener("click", () => applyColorToActive(hex));
      container.appendChild(swatch);
    });
  }

  canvas.onmousedown = (e) => {
    const rect = canvas.getBoundingClientRect();
    pickColor(e.clientX - rect.left, e.clientY - rect.top);
    canvas.onmousemove = (e2) => pickColor(e2.clientX - rect.left, e2.clientY - rect.top);
  };
  document.onmouseup = () => { canvas.onmousemove = null; };
}

function applyColorToActive(hex: string) {
  if (!activeColorField) return;
  customVars[activeColorField] = hex;
  applyCustomCSSVars(customVars);
  const swatch = document.getElementById(`swatch-${activeColorField}`);
  if (swatch) swatch.style.backgroundColor = hex;
}

function attachSaveThemeListener() {
  document.getElementById("btn-save-custom-theme")?.addEventListener("click", () => {
    const saveArea = document.getElementById("theme-save-area");
    if (!saveArea) return;
    
    saveArea.innerHTML = `<input type="text" id="theme-name-input" class="styled-input" placeholder="Theme Name..." />`;
    const input = document.getElementById("theme-name-input") as HTMLInputElement;
    
    let defaultName = currentTheme;
    const builtins = ["faerie-light", "faerie-dark", "nord", "solarized"];
    if (builtins.includes(currentTheme)) {
      defaultName = `${currentTheme}-custom`;
      const saved = JSON.parse(localStorage.getItem("savedThemes") || "{}");
      let i = 2;
      let tryName = defaultName;
      while(saved[tryName]) {
        tryName = `${defaultName}-${i}`;
        i++;
      }
      defaultName = tryName;
    }
    input.value = defaultName;
    input.focus();
    
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const saved = JSON.parse(localStorage.getItem("savedThemes") || "{}");
        const finalName = input.value.trim() || defaultName;
        saved[finalName] = { ...customVars };
        localStorage.setItem("savedThemes", JSON.stringify(saved));
        
        populateThemeDropdown();
        const sel = document.getElementById("theme-selected");
        if (sel) sel.textContent = finalName;
        currentTheme = finalName;
        document.getElementById("theme-builder-title")!.textContent = `Edit Theme (${currentTheme})`;
        
        saveArea.innerHTML = `<button id="btn-save-custom-theme" class="sidebar-btn">Saved!</button>`;
        setTimeout(() => {
          if (document.getElementById("btn-save-custom-theme")) {
            document.getElementById("btn-save-custom-theme")!.textContent = "Save Theme";
          }
        }, 1500);
        attachSaveThemeListener(); 
      }
    });
  });
}
attachSaveThemeListener();

document.getElementById("btn-edit-json")?.addEventListener("click", () => {
  if (!editorView) return;
  const btn = document.getElementById("btn-edit-json")!;
  if (!isEditingSettings) {
    isEditingSettings = true;
    previousDocContent = editorView.state.doc.toString();
    
    const padX = document.documentElement.style.getPropertyValue("--editor-padding-x").replace("px", "") || "60";
    const padY = document.documentElement.style.getPropertyValue("--editor-padding-y").replace("px", "") || "60";
    const fs = document.documentElement.style.getPropertyValue("--font-size").replace("px", "") || "18";
    
    const computed = getComputedStyle(document.documentElement);
    let activeColors: Record<string, string> = {};
    themeFields.forEach(f => {
      activeColors[f.id] = computed.getPropertyValue(f.id).trim();
    });
    
    const settings = {
      name: currentTheme,
      font: currentFont,
      paddingX: parseInt(padX),
      paddingY: parseInt(padY),
      fontSize: parseInt(fs),
      colors: activeColors
    };
    
    editorView.dispatch({
      changes: {from: 0, to: previousDocContent.length, insert: JSON.stringify(settings, null, 2)}
    });
    btn.textContent = "Close Settings (Return to File)";
    closeSidebar();
  } else {
    // Save current theme colors before exiting
    try {
      const text = editorView.state.doc.toString();
      const settings = JSON.parse(text);
      if (settings.colors && settings.name) {
        const builtins = ["faerie-light", "faerie-dark", "nord", "solarized"];
        if (!builtins.includes(settings.name)) {
          const saved = JSON.parse(localStorage.getItem("savedThemes") || "{}");
          saved[settings.name] = settings.colors;
          localStorage.setItem("savedThemes", JSON.stringify(saved));
          populateThemeDropdown();
          currentTheme = settings.name;
          const sel = document.getElementById("theme-selected");
          if (sel) sel.textContent = settings.name;
        }
      }
    } catch(e) {}

    isEditingSettings = false;
    editorView.dispatch({
      changes: {from: 0, to: editorView.state.doc.length, insert: previousDocContent}
    });
    btn.textContent = "Edit Settings (JSON)";
    closeSidebar();
  }
});

// System theme auto-detection
(function detectSystemTheme() {
  const faerieLightColors: Record<string, string> = {
    "--bg-color": "#ffffff",
    "--text-color": "#575757",
    "--md-heading": "#4d4d4d",
    "--md-bold": "#253e91",
    "--md-italic": "#557cc2",
    "--md-code": "#c4854d",
    "--md-bg-code": "#f5f5f5"
  };
  const faerieDarkColors: Record<string, string> = {
    "--bg-color": "#000000",
    "--text-color": "#b8b2a1",
    "--md-heading": "#babddb",
    "--md-bold": "#7186db",
    "--md-italic": "#86d3db",
    "--md-code": "#db8028",
    "--md-bg-code": "#2a2a2a"
  };

  // Register built-in faerie themes in savedThemes so they can be selected
  const saved = JSON.parse(localStorage.getItem("savedThemes") || "{}");
  saved["faerie-light"] = faerieLightColors;
  saved["faerie-dark"] = faerieDarkColors;
  localStorage.setItem("savedThemes", JSON.stringify(saved));
  populateThemeDropdown();

  // On first launch (no theme preference saved), auto-detect
  if (!localStorage.getItem("userTheme")) {
    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const themeName = isDark ? "faerie-dark" : "faerie-light";
    currentTheme = themeName;
    applyThemePreview(themeName);
    const sel = document.getElementById("theme-selected");
    if (sel) sel.textContent = themeName;

    // Apply default paddings and font size
    document.documentElement.style.setProperty("--editor-padding-x", "120px");
    document.documentElement.style.setProperty("--editor-padding-y", "100px");
    document.documentElement.style.setProperty("--font-size", "30px");
    (document.getElementById("padding-x-slider") as HTMLInputElement).value = "120";
    (document.getElementById("padding-y-slider") as HTMLInputElement).value = "100";
    (document.getElementById("fontsize-slider") as HTMLInputElement).value = "30";

    localStorage.setItem("userTheme", themeName);
  } else {
    const themeName = localStorage.getItem("userTheme")!;
    currentTheme = themeName;
    applyThemePreview(themeName);
    const sel = document.getElementById("theme-selected");
    if (sel) sel.textContent = themeName;
  }
})();
