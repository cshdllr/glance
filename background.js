const BLOCKED_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "chrome-search://",
  "chrome-untrusted://",
  "edge://",
  "about:",
  "view-source:",
  "devtools://",
  "https://chrome.google.com/webstore",
  "https://chromewebstore.google.com"
];

function isBlockedUrl(url) {
  if (!url) return true;
  return BLOCKED_PREFIXES.some(p => url.startsWith(p));
}

async function flashBadge(tabId, text, color) {
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: color || "#e74c3c" });
    await chrome.action.setBadgeText({ tabId, text });
    setTimeout(() => {
      chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
    }, 2500);
  } catch {}
}

async function trigger(tab) {
  if (!tab || tab.id == null) return;
  if (isBlockedUrl(tab.url)) {
    flashBadge(tab.id, "N/A");
    return;
  }

  // First try: call the toggle if the content script is already loaded.
  let toggled = false;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        if (typeof window.__glanceToggle === "function") {
          window.__glanceToggle();
          return true;
        }
        return false;
      }
    });
    toggled = !!(result && result.result);
  } catch (err) {
    flashBadge(tab.id, "!");
    return;
  }

  if (toggled) return;

  // Fallback: inject the content script + CSS, then call the toggle.
  try {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["inspector.css"]
    });
  } catch {}

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });
  } catch (err) {
    flashBadge(tab.id, "!");
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        if (typeof window.__glanceToggle === "function") {
          window.__glanceToggle();
        }
      }
    });
  } catch {
    flashBadge(tab.id, "!");
  }
}

chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-inspector") return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) trigger(tabs[0]);
  });
});

chrome.action.onClicked.addListener((tab) => {
  trigger(tab);
});
