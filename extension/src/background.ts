// The board needs real space, not a default_popup's small fixed window --
// clicking the toolbar icon opens the game in its own full tab instead.
chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("index.html") });
});
