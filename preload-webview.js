// Preload script injected into webview to intercept link clicks
// This prevents links from opening in new windows and allows them to load in the same webview

// Get current URL to check if we're on a challenge page
const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
const isChallengeUrl = /challenges\.cloudflare\.com|turnstile/i.test(currentUrl);

// Only intercept window.open if NOT on a Cloudflare challenge page
// (Turnstile needs window.open capabilities for its iframe)
if (!isChallengeUrl) {
  const originalOpen = window.open;
  window.open = function(url, target, features) {
    // Instead of opening a new window, navigate in the current webview
    if (url) {
      window.location.href = url;
    }
    return null;
  };
}

// Intercept link clicks to prevent target="_blank" EXCEPT for challenge pages
if (!isChallengeUrl) {
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
}

console.log('Webview preload script loaded - intercepting new window attempts (except on challenge pages)');

// Intercept Web Notification API and forward to the host
let ipcRenderer = null;
try {
  ({ ipcRenderer } = require('electron'));
} catch (e) {}

// Reduce automation fingerprints for bot challenges.
try {
  if (Object.getOwnPropertyDescriptor(Navigator.prototype, 'webdriver')) {
    Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => undefined });
  } else if (typeof navigator !== 'undefined') {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  }
} catch (e) {}

// Additional lightweight fingerprint hardening for common bot checks.
try {
  if (typeof window !== 'undefined' && !window.chrome) {
    window.chrome = { runtime: {} };
  }
} catch (e) {}

try {
  if (typeof navigator !== 'undefined') {
    if (navigator.languages && navigator.languages.length === 0) {
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    }
    if (navigator.plugins && navigator.plugins.length === 0) {
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
    }
  }
} catch (e) {}

try {
  const NativeNotification = window.Notification;

  if (NativeNotification) {
    class WrappedNotification extends NativeNotification {
      constructor(title, options) {
        super(title, options);
        try {
          ipcRenderer.sendToHost('web-notification', {
            title: title || 'Notification',
            body: options && options.body ? options.body : '',
            icon: options && options.icon ? options.icon : '',
            tag: options && options.tag ? options.tag : '',
            url: window.location.href,
            timestamp: Date.now()
          });
        } catch (e) {}
      }
    }

    // Preserve static properties
    WrappedNotification.requestPermission = (...args) => NativeNotification.requestPermission(...args);
    Object.defineProperty(WrappedNotification, 'permission', {
      get: () => NativeNotification.permission
    });

    window.Notification = WrappedNotification;
  }
} catch (e) {}

// Forward user gestures to host to help block scroll-triggered redirects
try {
  if (ipcRenderer) {
    const signal = () => {
      try { ipcRenderer.sendToHost('user-gesture'); } catch (e) {}
    };
    document.addEventListener('mousedown', signal, true);
    document.addEventListener('touchstart', signal, true);
    document.addEventListener('keydown', signal, true);
  }
} catch (e) {}

// Forward scroll activity to host (throttled)
try {
  if (ipcRenderer) {
    let lastScrollSent = 0;
    const onScroll = () => {
      const now = Date.now();
      if (now - lastScrollSent < 300) return;
      lastScrollSent = now;
      try { ipcRenderer.sendToHost('user-scroll'); } catch (e) {}
    };
    window.addEventListener('scroll', onScroll, true);
  }
} catch (e) {}

// Password capture is intentionally disabled until secure OS-backed storage is implemented.
