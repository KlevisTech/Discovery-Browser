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

// Intercept Web Notification API and forward to the host
let ipcRenderer = null;
try {
  ({ ipcRenderer } = require('electron'));
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

// Detect login submissions and forward credentials to the host (card window)
try {
  if (ipcRenderer) {
    if (!window.__pwdDetectorActive) {
      window.__pwdDetectorActive = true;

      function findCreds(form) {
        const pw = form.querySelector('input[type="password"]');
        if (!pw || !pw.value) return null;
        let user = form.querySelector('input[type="email"]')
          || form.querySelector('input[type="text"]')
          || form.querySelector('input[type="tel"]');
        if (!user) {
          const all = Array.from(form.querySelectorAll('input'));
          const idx = all.indexOf(pw);
          for (let i = idx - 1; i >= 0; i--) {
            if (all[i].type !== 'hidden' && all[i].type !== 'password') { user = all[i]; break; }
          }
        }
        return { username: (user && user.value) ? user.value.trim() : '', password: pw.value };
      }

      function sendCreds(creds) {
        if (!creds || !creds.password) return;
        try {
          ipcRenderer.sendToHost('password-detected', {
            site: window.location.href,
            username: creds.username || '',
            password: creds.password
          });
        } catch (e) {}
      }

      document.addEventListener('submit', (e) => {
        const c = findCreds(e.target);
        sendCreds(c);
      }, true);

      document.addEventListener('click', (e) => {
        const btn = e.target.closest('button[type="submit"],input[type="submit"],button:not([type])');
        if (!btn) return;
        const form = btn.closest('form');
        if (!form) return;
        const c = findCreds(form);
        sendCreds(c);
      }, true);
    }
  }
} catch (e) {}
