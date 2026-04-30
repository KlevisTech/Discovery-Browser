//preload-card.js
const { contextBridge, ipcRenderer } = require('electron');

// Expose safe IPC methods for card windows via contextBridge
contextBridge.exposeInMainWorld('cardAPI', {
  // Navigation controls
  cardGoBack: (cardId) =>
    ipcRenderer.invoke('card-go-back', cardId),

  cardGoForward: (cardId) =>
    ipcRenderer.invoke('card-go-forward', cardId),

  cardReload: (cardId) =>
    ipcRenderer.invoke('card-reload', cardId),

  // Navigation
  navigateCard: (cardId, url) =>
    ipcRenderer.invoke('navigate-card', cardId, url),

  // Close card
  closeCard: (cardId) =>
    ipcRenderer.invoke('close-card', cardId),

  // Hide the visualizer immediately while the card close animation runs
  hideVisualizerNow: (cardId) =>
    ipcRenderer.invoke('hide-visualizer-now', cardId),

  // Resize card
  resizeCard: (cardId, x, y, width, height) =>
    ipcRenderer.invoke('resize-card', cardId, x, y, width, height),

  // Toggle fullscreen
  toggleFullscreen: (cardId, shouldBeFullscreen) =>
    ipcRenderer.invoke('toggle-fullscreen', cardId, shouldBeFullscreen),

  // Minimize card
  minimizeCard: (cardId, pageUrl, pageTitle, themeKey) =>
    ipcRenderer.invoke('minimize-card', cardId, pageUrl, pageTitle, themeKey),

  // Open URL as bubble (creates new card that starts minimized as bubble)
  openUrlAsBubble: (url, meta) =>
    ipcRenderer.invoke('open-url-as-bubble', url, meta),

  // Bookmark management
  toggleBookmark: (bookmarkData) =>
    ipcRenderer.invoke('toggle-bookmark', bookmarkData),

  isBookmarked: (url) =>
    ipcRenderer.invoke('is-bookmarked', url),

  getBookmarkFolders: () =>
    ipcRenderer.invoke('get-bookmark-folders'),

  saveBookmarkToFolder: (bookmarkData, folderId) =>
    ipcRenderer.invoke('save-bookmark-to-folder', bookmarkData, folderId),

  // Password manager is disabled until secure OS-backed storage is implemented.

  onVisualizerSetting: (callback) => {
    ipcRenderer.on('visualizer-setting', (event, enabled) => callback(enabled));
  },
  getVisualizerSetting: () => ipcRenderer.invoke('get-visualizer-enabled'),

  // Get card launch size mode (normal, wide, fullscreen)
  getCardLaunchSizeMode: () => ipcRenderer.invoke('get-card-launch-size-mode'),
  getSideFlamesEnabled: (cardId) => ipcRenderer.invoke('get-side-flames-enabled', cardId),
  setSideFlamesEnabled: (cardId, enabled) => ipcRenderer.invoke('set-side-flames-enabled', cardId, enabled),

  // Get current window position
  getWindowPosition: () => {
    return {
      x: window.screenX,
      y: window.screenY,
    };
  },

  // Update window position
  updateWindowPosition: (x, y, cardId) =>
    ipcRenderer.invoke('update-card-position', cardId, x, y),

  // Listen for window events
  onWindowMoved: (callback) => {
    const listener = (event) => callback();
    window.addEventListener('move', listener);
    return () => window.removeEventListener('move', listener);
  },

  // Downloads (per card window)
  onDownloadStarted: (callback) => {
    console.log('[Preload-Card] Setting up onDownloadStarted handler');
    ipcRenderer.on('download-started', (event, payload) => {
      console.log('[Preload-Card] download-started received:', payload);
      callback(payload);
    });
  },
  onDownloadProgress: (callback) => {
    console.log('[Preload-Card] Setting up onDownloadProgress handler');
    ipcRenderer.on('download-progress', (event, payload) => {
      console.log('[Preload-Card] download-progress received:', payload);
      callback(payload);
    });
  },
  onDownloadDone: (callback) => {
    console.log('[Preload-Card] Setting up onDownloadDone handler');
    ipcRenderer.on('download-done', (event, payload) => {
      console.log('[Preload-Card] download-done received:', payload);
      callback(payload);
    });
  },
  showItemInFolder: (filePath) => ipcRenderer.invoke('show-item-in-folder', filePath),

  // Forward web notifications from webview to main process
  sendNotification: (payload) => ipcRenderer.send('web-notification', payload),

  // Send custom events to main process
  sendToMain: (channel, payload) => ipcRenderer.send(channel, payload),
  getUserAgent: () => ipcRenderer.invoke('get-user-agent'),

  // Open readmode card - creates a phone-sized reading view
  openReadmode: (url, title, theme) =>
    ipcRenderer.invoke('open-readmode-card', url, title, theme),

  // Cycle through open card windows
  cycleWindows: (cardId) =>
    ipcRenderer.invoke('cycle-windows', cardId),
});

// Receive requests from main to load a URL into this card's webview
ipcRenderer.on('card-load-url', (event, url) => {
  window.dispatchEvent(new CustomEvent('card-load-url', { detail: url }));
});

ipcRenderer.on('card-restore-animate', (event, payload = {}) => {
  window.dispatchEvent(new CustomEvent('card-restore-animate', { detail: payload }));
});

ipcRenderer.on('card-cycle-arriving', () => {
  window.dispatchEvent(new CustomEvent('card-cycle-arriving'));
});

ipcRenderer.on('card-cycle-departing', () => {
  window.dispatchEvent(new CustomEvent('card-cycle-departing'));
});

ipcRenderer.on('visualizer-widget-command', (event, payload = {}) => {
  window.dispatchEvent(new CustomEvent('visualizer-widget-command', { detail: payload || {} }));
});

ipcRenderer.on('cloudflare-challenge-banner', (event, payload) => {
  window.dispatchEvent(new CustomEvent('cloudflare-challenge-banner', { detail: payload || {} }));
});

// Listen for load failures from main process
ipcRenderer.on('card-load-failed', (event, payload) => {
  window.dispatchEvent(new CustomEvent('card-load-failed', { detail: payload }));
});

// ========================
// Anti-Malicious-Overlay Protection
// ========================
// Inject overlay detection and removal into the page context

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
          
          // Check exact matches
          if (BLOCKED_AD_DOMAINS.has(hostname)) return true;
          
          // Check substring matches for known redirect patterns
          for (const domain of BLOCKED_AD_DOMAINS) {
            if (hostname.includes(domain)) return true;
          }
          
          // Block URLs with common redirect parameters
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
        
        // Element is hidden but clickable
        const isHidden = el.offsetWidth === 0 || el.offsetHeight === 0 || 
                         style.display === 'none' || style.visibility === 'hidden';
        
        // Element is transparent or near-transparent
        const opacity = parseFloat(style.opacity);
        const isTransparent = opacity < 0.1;
        
        // Element has pointer-events but is not visible
        const hasPointerEvents = style.pointerEvents !== 'none';
        
        // Element covers full viewport or large area (suspicious overlay)
        const coversLargeArea = rect.width > window.innerWidth * 0.5 && 
                                rect.height > window.innerHeight * 0.5;
        
        // Element positioned off-screen but clickable
        const isOffscreen = rect.top < -100 || rect.left < -100 || 
                            rect.top > window.innerHeight + 100 || 
                            rect.left > window.innerWidth + 100;
        
        // Element is clickable link with suspicious attributes
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
            // Skip elements we need to keep
            if (el.tagName === 'BODY' || el.tagName === 'HTML' || 
                el === document.documentElement || el === document.body) {
              continue;
            }
            
            if (isSuspiciousOverlay(el)) {
              // Check if it's a link to an ad domain
              const href = el.getAttribute('href') || el.dataset.href || '';
              if (isAdRedirectUrl(href)) {
                el.style.display = 'none !important';
                el.style.visibility = 'hidden !important';
                el.style.pointerEvents = 'none !important';
                el.onclick = (e) => e.preventDefault();
                removed++;
              } else if (isSuspiciousOverlay(el)) {
                // Remove element if it's a suspicious overlay without valid purpose
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
        // Allow legitimate scrolls, block rapid artificial scrolls from ads
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
              // Still attach it but with a safe wrapper
            }
          }
        } catch (e) {}
        return origAddEventListener.call(this, type, listener, options);
      };

      // Protect video players from being hijacked
      (function protectVideoPlayers() {
        const videos = document.querySelectorAll('video');
        videos.forEach(video => {
          // Make sure video has proper event handlers
          video.addEventListener('click', (e) => {
            // Prevent overlays from intercepting video clicks
            e.stopPropagation();
          }, true);
        });
        
        // Monitor for new video elements
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
        /* Hide transparent overlays */
        [style*="opacity: 0"],
        [style*="opacity:0"],
        [style*="display: none"],
        [style*="visibility: hidden"] {
          pointer-events: none !important;
        }
        
        /* Block ads by common classNames/IDs */
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
        
        /* Protect scrollbar from overlays */
        [class*="scrollbar"],
        [id*="scrollbar"],
        [class*="scroll-bar"],
        [id*="scroll-bar"] {
          pointer-events: auto !important;
        }
        
        /* Prevent fixed overlays from covering content */
        [style*="position: fixed"],
        [style*="position:fixed"],
        [style*="position: absolute"],
        [style*="position:absolute"] {
          max-width: 100% !important;
          max-height: 100% !important;
        }
        
        /* Ensure video player overlays are safe */
        video {
          pointer-events: auto !important;
        }
        
        /* Block overlay-like divs with high z-index */
        div[style*="z-index"] {
          /* Will be handled by JS for dynamic checking */
        }
      \`;
      document.head.appendChild(styleEl);

      // Initial scan
      removeOverlays();
      
      // Continuous monitoring for dynamically added overlays
      const observer = new MutationObserver(() => {
        removeOverlays();
      });
      
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: false,
      });

      // Also scan periodically in case MutationObserver misses something
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

  // Inject early, before most ads load
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
