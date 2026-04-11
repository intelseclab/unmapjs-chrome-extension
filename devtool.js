// Registers the UnmapJS DevTools panel for resource capture.
chrome.devtools.panels.create(
  'UnmapJS',
  'icons/icon16.png',
  'panel.html',
  function() {}
);
