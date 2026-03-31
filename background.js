chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-inspector") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      // Inject the content script programmatically as a fallback
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: () => {
          if (window.__lookerToggle) {
            window.__lookerToggle();
          }
        }
      });
    });
  }
});

// Also handle toolbar icon click as a fallback trigger
chrome.action.onClicked.addListener((tab) => {
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      if (window.__lookerToggle) {
        window.__lookerToggle();
      }
    }
  });
});
