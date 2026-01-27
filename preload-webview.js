// Preload script injected into webview to intercept link clicks
// This prevents links from opening in new windows and allows them to load in the same webview

// Prevent window.open calls
const originalOpen = window.open;
window.open = function(url, target, features) {
  // Instead of opening a new window, navigate in the current webview
  if (url) {
    window.location.href = url;
  }
  return null;
};

// Intercept link clicks to prevent target="_blank"
document.addEventListener('click', (e) => {
  const link = e.target.closest('a');
  if (link && link.href) {
    const target = link.getAttribute('target');
    // If the link has target="_blank" or target="_new", prevent it and navigate in current window
    if (target === '_blank' || target === '_new') {
      e.preventDefault();
      e.stopPropagation();
      window.location.href = link.href;
    }
  }
}, true);

console.log('Webview preload script loaded - intercepting new window attempts');
