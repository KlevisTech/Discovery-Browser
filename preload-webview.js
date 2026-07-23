// Preload script injected into webview to intercept link clicks
// This prevents links from opening in new windows and allows them to load in the same webview

// Get current URL to check if we're on a challenge page
const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
const isChallengeUrl = /challenges\.cloudflare\.com|turnstile/i.test(currentUrl);

// Intercept link clicks to prevent target="_blank" EXCEPT for challenge pages
if (!isChallengeUrl) {
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (link && link.href) {
      const target = link.getAttribute('target');
      let destinationUrl = link.href;
      let isGoogleResult = false;
      try {
        const pageUrl = new URL(window.location.href);
        const linkUrl = new URL(link.href, pageUrl.href);
        const onGoogleResults = /(^|\.)google\./i.test(pageUrl.hostname) && pageUrl.pathname === '/search';
        if (onGoogleResults) {
          isGoogleResult = true;
          if (/(^|\.)google\./i.test(linkUrl.hostname) && linkUrl.pathname === '/url') {
            const decodedTarget = linkUrl.searchParams.get('q') || linkUrl.searchParams.get('url');
            if (decodedTarget && /^https?:\/\//i.test(decodedTarget)) destinationUrl = decodedTarget;
          }
        }
      } catch (error) { }

      // Google results and new-window links are opened explicitly in this card.
      if (isGoogleResult || target === '_blank' || target === '_new') {
        e.preventDefault();
        e.stopImmediatePropagation();
        try {
          require('electron').ipcRenderer.sendToHost('open-link-current', destinationUrl);
        } catch (error) {
          window.location.assign(destinationUrl);
        }
      }
    }
  }, true);
}

console.log('Webview preload script loaded - preserving browser popup behavior for challenge flows');
// Disable WebAuthn/passkey prompts in site webviews. In unsigned Electron builds,
// Windows surfaces these as USB security-key dialogs from electron.exe, which traps
// normal password sign-in flows on sites such as Instagram/Meta.
(function disableWebAuthnPrompts() {
  const script = document.createElement('script');
  script.type = 'text/javascript';
  script.textContent = `
    (() => {
      try {
        const rejectWebAuthn = () => Promise.reject(new DOMException('Passkey sign-in is disabled in this browser window. Use password or another sign-in method.', 'NotAllowedError'));
        const wrapCredentialMethod = (methodName) => {
          try {
            if (!window.CredentialsContainer || !CredentialsContainer.prototype) return;
            const nativeMethod = CredentialsContainer.prototype[methodName];
            if (typeof nativeMethod !== 'function' || nativeMethod.__discoveryWebAuthnWrapped) return;
            const wrapped = function(options) {
              try {
                if (options && options.publicKey) return rejectWebAuthn();
              } catch (e) {}
              return nativeMethod.apply(this, arguments);
            };
            wrapped.__discoveryWebAuthnWrapped = true;
            Object.defineProperty(CredentialsContainer.prototype, methodName, {
              configurable: true,
              writable: true,
              value: wrapped,
            });
          } catch (e) {}
        };

        wrapCredentialMethod('get');
        wrapCredentialMethod('create');

        if (window.PublicKeyCredential) {
          try {
            Object.defineProperty(PublicKeyCredential, 'isConditionalMediationAvailable', {
              configurable: true,
              writable: true,
              value: () => Promise.resolve(false),
            });
          } catch (e) {}
          try {
            Object.defineProperty(PublicKeyCredential, 'isUserVerifyingPlatformAuthenticatorAvailable', {
              configurable: true,
              writable: true,
              value: () => Promise.resolve(false),
            });
          } catch (e) {}
        }
      } catch (e) {}
    })();
  `;

  const inject = () => {
    try {
      const target = document.documentElement || document.head;
      if (!target) return false;
      target.prepend(script);
      script.remove();
      return true;
    } catch (e) {
      return false;
    }
  };

  if (!inject()) {
    document.addEventListener('DOMContentLoaded', inject, { once: true });
  }
})();

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
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      try { ipcRenderer.sendToHost('escape-key'); } catch (e) {}
    }, true);
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

// ========================
// Anti-Malicious-Overlay Protection (Webview Edition)
// ========================

(function initializeOverlayProtection() {
  const injectionScript = document.createElement('script');
  injectionScript.type = 'text/javascript';
  injectionScript.textContent = `
    (function() {
      'use strict';

      // Known ad/redirect domains to block
      const BLOCKED_AD_DOMAINS = new Set([
        'bit.ly', 'tinyurl.com', 'ow.ly', 'buff.ly', 'is.gd',
        'short.link', 'shortened.me', 'clickserve.com', 'click.links.com',
        'adcash.com', 'adnow.com', 'adfly.click', 'linkvertise.com',
        'linkredirect.com', 'clk.best', 'adf.ly', 'short2url.com',
        'ourl.co', 'clksite.com', 'xn--80akhbyknj4f.com', 'fastclick.com'
      ]);

      // Detect if a URL is likely an ad redirect
      function isAdRedirectUrl(url) {
        try {
          const urlObj = new URL(url);
          const hostname = urlObj.hostname.toLowerCase();
          
          if (BLOCKED_AD_DOMAINS.has(hostname)) return true;
          
          for (const domain of BLOCKED_AD_DOMAINS) {
            if (hostname.includes(domain)) return true;
          }
          
          const params = urlObj.search + urlObj.hash;
          if (/[?#](r|ref|return|click|track|redirect|url|link|destination)=/i.test(params)) {
            if (hostname !== window.location.hostname) {
              return true;
            }
          }
        } catch (e) {}
        return false;
      }

      // Detect suspicious overlay elements
      function isSuspiciousOverlay(el) {
        if (!el) return false;
        
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        
        const isHidden = el.offsetWidth === 0 || el.offsetHeight === 0 || 
                         style.display === 'none' || style.visibility === 'hidden';
        
        const opacity = parseFloat(style.opacity);
        const isTransparent = opacity < 0.1;
        
        const hasPointerEvents = style.pointerEvents !== 'none';
        
        const coversLargeArea = rect.width > window.innerWidth * 0.5 && 
                                rect.height > window.innerHeight * 0.5;
        
        const isOffscreen = rect.top < -100 || rect.left < -100 || 
                            rect.top > window.innerHeight + 100 || 
                            rect.left > window.innerWidth + 100;
        
        const isLink = el.tagName === 'A' || el.onclick !== null;
        const hasSuspiciousAttrs = /^(script|frame|object|embed)$/i.test(el.tagName) ||
                                   el.hasAttribute('data-click-tracking') ||
                                   el.hasAttribute('data-redirect') ||
                                   el.className.includes('ad') ||
                                   el.className.includes('click') ||
                                   el.id.includes('ad') ||
                                   el.id.includes('banner');
        
        return (isTransparent || isHidden || isOffscreen) && (isLink || coversLargeArea || hasSuspiciousAttrs);
      }

      // Remove malicious overlays and ads
      function removeOverlays() {
        const elements = document.querySelectorAll('*');
        let removed = 0;
        
        for (const el of elements) {
          try {
            if (el.tagName === 'BODY' || el.tagName === 'HTML' || 
                el === document.documentElement || el === document.body) {
              continue;
            }
            
            if (isSuspiciousOverlay(el)) {
              const href = el.getAttribute('href') || el.dataset.href || '';
              if (isAdRedirectUrl(href)) {
                el.style.display = 'none !important';
                el.style.visibility = 'hidden !important';
                el.style.pointerEvents = 'none !important';
                el.onclick = (e) => e.preventDefault();
                removed++;
              } else if (isSuspiciousOverlay(el)) {
                const style = window.getComputedStyle(el);
                if ((parseFloat(style.opacity) < 0.1 || style.display === 'none') && 
                    style.pointerEvents !== 'none') {
                  el.style.display = 'none !important';
                  el.style.pointerEvents = 'none !important';
                  removed++;
                }
              }
            }
          } catch (e) {}
        }
        
        return removed;
      }

      // Intercept clicks to check for redirect domains
      document.addEventListener('click', (e) => {
        try {
          const target = e.target.closest('a') || e.target;
          if (!target) return;
          
          const href = target.getAttribute('href') || target.dataset.href || '';
          
          if (isAdRedirectUrl(href)) {
            console.warn('[Overlay Protection] Blocked click to ad domain:', href);
            e.preventDefault();
            e.stopPropagation();
            return false;
          }
        } catch (err) {}
      }, true);

      // Prevent scroll-jacking (preventing scroll hijacking by overlays)
      let lastScrollTime = 0;
      const origScroll = window.scrollBy;
      window.scrollBy = function(...args) {
        const now = Date.now();
        if (now - lastScrollTime > 500 || args[0] === 0 || args[1] === 0) {
          lastScrollTime = now;
          return origScroll.apply(window, args);
        }
        console.warn('[Overlay Protection] Scroll-jack attempt blocked');
      };

      // Monitor for sneaky scroll event handlers that trigger redirects
      const origAddEventListener = EventTarget.prototype.addEventListener;
      let scrollHandlerWatchCount = 0;
      EventTarget.prototype.addEventListener = function(type, listener, options) {
        try {
          if (type === 'scroll' && this === window) {
            const listenerStr = listener.toString();
            if (/redirect|navigate|location.href|window.open/i.test(listenerStr)) {
              console.warn('[Overlay Protection] Suspicious scroll handler detected and blocked');
              scrollHandlerWatchCount++;
              if (scrollHandlerWatchCount > 3) {
                console.warn('[Overlay Protection] Too many suspicious scroll handlers, page may be malicious');
              }
            }
          }
        } catch (e) {}
        return origAddEventListener.call(this, type, listener, options);
      };

      // Protect video players from being hijacked
      (function protectVideoPlayers() {
        const videos = document.querySelectorAll('video');
        videos.forEach(video => {
          video.addEventListener('click', (e) => {
            e.stopPropagation();
          }, true);
        });
        
        const videoObserver = new MutationObserver((mutations) => {
          mutations.forEach((mutation) => {
            if (mutation.addedNodes) {
              mutation.addedNodes.forEach((node) => {
                if (node.tagName === 'VIDEO' || (node.querySelector && node.querySelector('video'))) {
                  const vid = node.tagName === 'VIDEO' ? node : node.querySelector('video');
                  if (vid) {
                    vid.addEventListener('click', (e) => {
                      e.stopPropagation();
                    }, true);
                  }
                }
              });
            }
          });
        });
        
        videoObserver.observe(document.body, { childList: true, subtree: true });
      })();

      // Inject CSS to hide/remove suspicious elements
      const styleEl = document.createElement('style');
      styleEl.textContent = \`
        [style*="opacity: 0"],
        [style*="opacity:0"],
        [style*="display: none"],
        [style*="visibility: hidden"] {
          pointer-events: none !important;
        }
        
        .ad,
        .ads,
        .advertisement,
        .advert,
        [class*="ad-"],
        [class*="ad_"],
        [id*="ad-"],
        [id*="ad_"],
        [class*="banner"],
        [id*="banner"],
        [class*="click-trap"],
        [class*="click_trap"],
        [data-ad-id],
        [data-ad-unit] {
          display: none !important;
          pointer-events: none !important;
          height: 0 !important;
          width: 0 !important;
          overflow: hidden !important;
        }
        
        [class*="scrollbar"],
        [id*="scrollbar"],
        [class*="scroll-bar"],
        [id*="scroll-bar"] {
          pointer-events: auto !important;
        }
        
        [style*="position: fixed"],
        [style*="position:fixed"],
        [style*="position: absolute"],
        [style*="position:absolute"] {
          max-width: 100% !important;
          max-height: 100% !important;
        }
        
        video {
          pointer-events: auto !important;
        }
      \`;
      document.head.appendChild(styleEl);

      // Initial scan
      removeOverlays();
      
      // Continuous monitoring
      const observer = new MutationObserver(() => {
        removeOverlays();
      });
      
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: false,
      });

      // Also scan periodically
      const interval = setInterval(() => {
        removeOverlays();
      }, 2000);

      // Cleanup on page unload
      window.addEventListener('beforeunload', () => {
        clearInterval(interval);
        observer.disconnect();
      });
    })();
  `;

  if (document.documentElement.firstChild) {
    document.documentElement.insertBefore(injectionScript, document.documentElement.firstChild);
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      if (injectionScript.parentNode === null) {
        document.head.appendChild(injectionScript);
      }
    });
  }
})();
// Media player bridge: detect and style playable media from inside the webview.
// This avoids repeated host-side executeJavaScript calls, which some sites reject.
(function initializeDiscoveryMediaBridge() {
  if (!ipcRenderer) return;

  const STYLE_ID = 'discovery-media-player-focus-style';
  let lastSentAt = 0;

  function getActiveMedia() {
    try {
      const media = Array.from(document.querySelectorAll('video, audio'));
      return media.find((node) => node && !node.paused) || media[0] || null;
    } catch (e) {
      return null;
    }
  }

  function applyMediaFocus(target) {
    try {
      if (!target || target.tagName !== 'VIDEO') return false;
      let style = document.getElementById(STYLE_ID);
      if (!style) {
        style = document.createElement('style');
        style.id = STYLE_ID;
        (document.head || document.documentElement || document.body).appendChild(style);
      }
      style.textContent = [
        'html, body { margin: 0 !important; padding: 0 !important; width: 100% !important; height: 100% !important; overflow: hidden !important; background: #000 !important; }',
        'video { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; max-width: none !important; max-height: none !important; min-width: 100vw !important; min-height: 100vh !important; object-fit: contain !important; transform: none !important; opacity: 1 !important; visibility: visible !important; display: block !important; z-index: 2147483647 !important; background: #000 !important; }'
      ].join('\n');
      target.setAttribute('controls', 'controls');
      target.setAttribute('playsinline', '');
      return true;
    } catch (e) {
      return false;
    }
  }

  function sendMediaState(reason) {
    try {
      const active = getActiveMedia();
      const title = document.title || '';
      if (!active) {
        ipcRenderer.sendToHost('media-state', { hasMedia: false, title, reason });
        return;
      }
      if (!active.paused) applyMediaFocus(active);
      const sourceNode = active.querySelector ? active.querySelector('source[src]') : null;
      ipcRenderer.sendToHost('media-state', {
        hasMedia: true,
        title,
        reason,
        paused: !!active.paused,
        currentSrc: String(active.currentSrc || active.src || (sourceNode && sourceNode.src) || ''),
        currentTime: Number(active.currentTime || 0),
        duration: Number(active.duration || 0),
        volume: typeof active.volume === 'number' ? active.volume : 1,
        muted: !!active.muted,
        mediaType: active.tagName === 'AUDIO' ? 'audio' : 'video'
      });
    } catch (e) {
      try { ipcRenderer.sendToHost('media-state', { hasMedia: false, error: e && e.message ? e.message : String(e), reason }); } catch (err) {}
    }
  }

  function sendThrottled(reason) {
    const now = Date.now();
    if (now - lastSentAt < 350) return;
    lastSentAt = now;
    sendMediaState(reason);
  }

  function attachMedia(node) {
    try {
      if (!node || node.__discoveryMediaBridgeAttached || !/^(VIDEO|AUDIO)$/i.test(node.tagName || '')) return;
      node.__discoveryMediaBridgeAttached = true;
      node.addEventListener('play', () => sendMediaState('play'), true);
      node.addEventListener('playing', () => sendMediaState('playing'), true);
      node.addEventListener('pause', () => sendMediaState('pause'), true);
      node.addEventListener('ended', () => sendMediaState('ended'), true);
      node.addEventListener('volumechange', () => sendThrottled('volumechange'), true);
      node.addEventListener('timeupdate', () => sendThrottled('timeupdate'), true);
      node.addEventListener('loadedmetadata', () => sendMediaState('loadedmetadata'), true);
    } catch (e) {}
  }

  function scanMedia() {
    try {
      document.querySelectorAll('video, audio').forEach(attachMedia);
      sendThrottled('scan');
    } catch (e) {}
  }

  document.addEventListener('play', (event) => {
    attachMedia(event.target);
    sendMediaState('document-play');
  }, true);

  document.addEventListener('pause', (event) => {
    attachMedia(event.target);
    sendMediaState('document-pause');
  }, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanMedia, { once: true });
  } else {
    scanMedia();
  }

  try {
    const observer = new MutationObserver(scanMedia);
    observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
    window.addEventListener('beforeunload', () => observer.disconnect());
  } catch (e) {}
})();
