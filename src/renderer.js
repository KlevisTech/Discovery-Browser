//renderer.js

/**
 * Discovery Browser - Renderer Process
 * Handles card management for window-based architecture
 */

class DiscoveryBrowser {
  constructor() {
    this.cards = new Map(); // cardId -> cardData
    this.nextCardId = 1;
    this.activeCardId = null;
    
    // Tab management
    this.visitedTabs = new Map(); // url -> tabData
    this.maxTabs = 8;
    
    // History management
    this.history = []; // Array of {url, title, timestamp, favicon}
    this.maxHistoryItems = 1000;

    // Downloads
    this.activeDownloads = new Map(); // id -> {receivedBytes,totalBytes,percent,filename,url,savePath,state}
    this.downloadHistory = []; // newest first
    this.maxDownloadHistoryItems = 200;
    
    // Notifications
    this.notifications = [];
    this.maxNotifications = 20;

    // Search engine settings
    this.searchEngines = [
      {
        key: 'google',
        name: 'Google',
        searchUrl: 'https://www.google.com/search?q={query}',
        homeUrl: 'https://www.google.com',
        favicon: 'https://www.google.com/favicon.ico',
        placeholder: 'Search with Google',
      },
      {
        key: 'bing',
        name: 'Bing',
        searchUrl: 'https://www.bing.com/search?q={query}',
        homeUrl: 'https://www.bing.com',
        favicon: 'https://www.bing.com/sa/simg/favicon-2x.ico',
        placeholder: 'Search with Bing',
      },
      {
        key: 'duckduckgo',
        name: 'DuckDuckGo',
        searchUrl: 'https://duckduckgo.com/?q={query}',
        homeUrl: 'https://duckduckgo.com',
        favicon: 'https://duckduckgo.com/favicon.ico',
        placeholder: 'Search with DuckDuckGo',
      },
      {
        key: 'yahoo',
        name: 'Yahoo',
        searchUrl: 'https://search.yahoo.com/search?p={query}',
        homeUrl: 'https://search.yahoo.com',
        favicon: 'https://search.yahoo.com/favicon.ico',
        placeholder: 'Search with Yahoo',
      },
      {
        key: 'brave',
        name: 'Brave',
        searchUrl: 'https://search.brave.com/search?q={query}',
        homeUrl: 'https://search.brave.com',
        favicon: 'https://search.brave.com/favicon.ico',
        placeholder: 'Search with Brave',
      },
    ];
    this.searchEngineKey = 'google';
    
    // Layout constants
    this.headerBarHeight = 88;
    this.cardWidth = 650;
    this.cardHeight = 500;
    
    // Container references
    this.cardDock = document.getElementById('dock-content');
    this.newCardBtn = document.getElementById('new-card-btn');
    this.cardCountSpan = document.getElementById('card-count');
    this.tabsContainer = document.getElementById('tabs-container');
    this.tabCountSpan = document.getElementById('tab-count');
    this.notificationList = document.getElementById('notification-list');
    this.notificationsBtn = document.getElementById('notifications-btn');
    this.notificationPanel = document.getElementById('notification-panel');
    this.clearNotificationsBtn = document.getElementById('clear-notifications-btn');
    
    // Note: dock-content may not exist if we're using the new tab bar only
    if (!this.cardDock) {
      console.log('Dock disabled - using tab bar only');
    }
    
    // Initial position for new windows
    this.nextCardX = 200;
    this.nextCardY = 150;
    
    this.init();
  }

  async init() {
    // Setup event listeners
    const searchInput = document.getElementById('search-input');
    const googleSearchInput = document.getElementById('google-search-input');
    const googleSearchBtn = document.getElementById('google-search-btn');
    this.searchEngineLabel = document.getElementById('search-engine-label');
    this.searchEngineFavicon = document.getElementById('search-engine-favicon');
    this.searchEngineSelect = document.getElementById('search-engine-select');
    this.googleSearchInput = googleSearchInput;
    
    // Search input handler - create card on Enter key
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        let url = searchInput.value.trim();
        if (url) {
          url = this.normalizeUrl(url); // Add https:// if missing
          this.createCard(url);
          searchInput.value = ''; // Clear input after creating card
        }
      }
    });
    
    this.newCardBtn.addEventListener('click', () => this.createCard(this.getSearchEngineHomeUrl()));

    // Google search widget handlers
    const runGoogleSearch = () => {
      if (!googleSearchInput) return;
      const query = (googleSearchInput.value || '').trim();
      if (!query) return;
      const searchUrl = this.buildSearchUrl(query);
      this.createCard(searchUrl);
      googleSearchInput.value = '';
    };

    if (googleSearchInput) {
      googleSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          runGoogleSearch();
        }
      });
    }

    if (googleSearchBtn) {
      googleSearchBtn.addEventListener('click', () => runGoogleSearch());
    }

    this.loadSearchEngine();
    this.applySearchEngineToUI();
    if (this.searchEngineSelect) {
      this.populateSearchEngineSelect();
      this.searchEngineSelect.value = this.searchEngineKey;
      this.searchEngineSelect.addEventListener('change', () => {
        const nextKey = this.searchEngineSelect.value;
        this.setSearchEngine(nextKey);
      });
    }

    // Clock widget
    const clockTimeEl = document.getElementById('clock-time');
    const clockDateEl = document.getElementById('clock-date');
    const updateClock = () => {
      if (!clockTimeEl || !clockDateEl) return;
      const now = new Date();
      const timeStr = new Intl.DateTimeFormat('en-US', {
        hour: '2-digit',
        minute: '2-digit'
      }).format(now);
      const dateStr = new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        month: 'short',
        day: '2-digit'
      }).format(now);
      clockTimeEl.textContent = timeStr;
      clockDateEl.textContent = dateStr;
    };
    updateClock();
    setInterval(updateClock, 1000);
    
    // Extensions and Settings panel elements
    this.extensionsBtn = document.getElementById('extensions-btn');
    this.settingsBtn = document.getElementById('settings-btn');
    this.extensionsPanel = document.getElementById('extensions-panel');
    this.settingsPanel = document.getElementById('settings-panel');
    
    this.discoverAddonsBtn = document.getElementById('discover-addons-btn');
    this.extensionsSearchInput = document.getElementById('extensions-search-input');
    this.addonsListEl = document.getElementById('installed-addons-grid');
    this.noAddonsMsg = document.getElementById('no-addons-msg');
    this.addonDiscoveryModal = document.getElementById('addon-discovery-modal');
    this.addonSearchInput = document.getElementById('addon-search-input');
    this.addonSearchBtn = document.getElementById('addon-search-btn');
    this.addonSearchResults = document.getElementById('addon-search-results');
    this.closeDiscoveryModalBtn = document.getElementById('close-discovery-modal');
    this.visualizerToggle = document.getElementById('visualizer-toggle');

    this.installedAddons = new Map();
    this.loadAddons();

    if (this.extensionsBtn) {
      this.extensionsBtn.addEventListener('click', () => this.toggleExtensions());
    }
    
    if (this.settingsBtn) {
      this.settingsBtn.addEventListener('click', () => this.toggleSettings());
    }

    if (this.notificationsBtn) {
      this.notificationsBtn.addEventListener('click', () => this.toggleNotifications());
    }

    // Downloads UI (ring + history)
    this.downloadRingBtn = document.getElementById('download-ring');
    this.downloadRingFg = this.downloadRingBtn ? this.downloadRingBtn.querySelector('.download-ring__fg') : null;
    this.downloadsListEl = document.getElementById('downloads-list');
    this.loadDownloadHistory();
    this.renderDownloadHistory();

    // Notifications tray
    this.loadNotifications();
    if (this.notifications.length === 0) {
      this.seedDefaultNotifications();
    }
    this.renderNotifications();

    if (this.clearNotificationsBtn) {
      this.clearNotificationsBtn.addEventListener('click', () => {
        this.notifications = [];
        this.saveNotifications();
        this.renderNotifications();
      });
    }

    const clearDownloadsBtn = document.getElementById('clear-downloads-btn');
    if (clearDownloadsBtn) {
      clearDownloadsBtn.addEventListener('click', () => {
        this.downloadHistory = [];
        this.saveDownloadHistory();
        this.renderDownloadHistory();
      });
    }

    // Clicking ring opens Downloads settings tab
    if (this.downloadRingBtn) {
      this.downloadRingBtn.addEventListener('click', () => {
        // Open settings panel and switch to downloads tab
        if (this.settingsPanel) {
          this.settingsPanel.setAttribute('aria-hidden', 'false');
          this.settingsPanel.style.display = 'block';
        }
        this.activateSettingsTab('downloads');
      });
    }

    // Listen to download events from main process
    if (window.electronAPI && window.electronAPI.onDownloadStarted) {
      window.electronAPI.onDownloadStarted((payload) => this.onDownloadStarted(payload));
      window.electronAPI.onDownloadProgress((payload) => this.onDownloadProgress(payload));
      window.electronAPI.onDownloadDone((payload) => this.onDownloadDone(payload));
    }

    // Listen to web notifications
    if (window.electronAPI && window.electronAPI.onNotificationReceived) {
      window.electronAPI.onNotificationReceived((payload) => this.addNotificationFromWeb(payload));
    }
    
    // New folder button
    const newFolderBtn = document.getElementById('new-folder-btn');
    if (newFolderBtn) {
      newFolderBtn.addEventListener('click', () => this.createNewFolder());
    }
    
    if (this.discoverAddonsBtn) {
      this.discoverAddonsBtn.addEventListener('click', () => {
        const query = (this.extensionsSearchInput && this.extensionsSearchInput.value || '').trim();
        this.openAddonDiscovery(query);
      });
    }

    if (this.extensionsSearchInput) {
      this.extensionsSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const query = (this.extensionsSearchInput.value || '').trim();
          this.openAddonDiscovery(query);
        }
      });
    }

    if (this.addonSearchBtn) {
      this.addonSearchBtn.addEventListener('click', () => this.searchAddons());
    }

    if (this.addonSearchInput) {
      this.addonSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.searchAddons();
      });
    }

    if (this.closeDiscoveryModalBtn) {
      this.closeDiscoveryModalBtn.addEventListener('click', () => this.closeAddonDiscovery());
    }

    if (this.addonDiscoveryModal) {
      const overlay = this.addonDiscoveryModal.querySelector('.modal-overlay');
      if (overlay) {
        overlay.addEventListener('click', () => this.closeAddonDiscovery());
      }
    }

    // Visualizer toggle
    if (this.visualizerToggle) {
      const saved = localStorage.getItem('visualizerEnabled');
      const enabled = saved === null ? false : saved === 'true';
      this.visualizerToggle.checked = enabled;
      if (window.electronAPI && window.electronAPI.setVisualizerEnabled) {
        window.electronAPI.setVisualizerEnabled(enabled);
      }
      this.visualizerToggle.addEventListener('change', () => {
        const value = this.visualizerToggle.checked;
        localStorage.setItem('visualizerEnabled', String(value));
        if (window.electronAPI && window.electronAPI.setVisualizerEnabled) {
          window.electronAPI.setVisualizerEnabled(value);
        }
      });
    }
    
    window.electronAPI.onCardClosed((cardId) => {
      this.removeCard(cardId);
    });
    
    window.electronAPI.onCardTitleUpdated((cardId, title) => {
      this.updateCardTitle(cardId, title);
    });
    
    window.electronAPI.onCardUrlUpdated((cardId, url) => {
      this.updateCardUrl(cardId, url);
    });

    // Listen for page finish loading - add to history
    window.electronAPI.onCardLoadingFinish((cardId, title, url) => {
      const cardData = this.cards.get(cardId);
      if (cardData) {
        // Update card data
        cardData.title = title || 'New Tab';
        cardData.url = url;
      }
    });
    
    // Load saved tabs from localStorage
    this.loadTabs();
    
    // Bookmark management
    this.bookmarks = new Map(); // url -> bookmark data
    this.bookmarkFolders = new Map(); // folderId -> { name, bookmarks: [] }
    this.nextFolderId = 1;
    this.loadBookmarks();
    this.loadBookmarkFolders();
    
    // Listen for bookmark toggle from card windows
    window.electronAPI.onToggleBookmark((bookmarkData) => {
      this.toggleBookmark(bookmarkData);
    });
    
    // Listen for bookmark status checks from card windows
    window.electronAPI.onCheckBookmarkStatus((url) => {
      // Check if bookmark exists in any folder
      let isBookmarked = false;
      for (const folder of this.bookmarkFolders.values()) {
        if (folder.bookmarks.some(b => b.url === url)) {
          isBookmarked = true;
          break;
        }
      }
      window.electronAPI.sendBookmarkStatus(isBookmarked);
    });

    // Card window requests folder list for its picker
    window.electronAPI.onGetBookmarkFolders(() => {
      const folders = Array.from(this.bookmarkFolders.values()).map(f => ({
        id: f.id,
        name: f.name,
        count: f.bookmarks.length
      }));
      window.electronAPI.sendBookmarkFolders(folders);
    });

    // Listen for bookmark status checks from card windows
    window.electronAPI.onCheckBookmarkStatus((url) => {
      // Check if bookmark exists in any folder
      let isBookmarked = false;
      for (const folder of this.bookmarkFolders.values()) {
        if (folder.bookmarks.some(b => b.url === url)) {
          isBookmarked = true;
          break;
        }
      }
      window.electronAPI.sendBookmarkStatus(isBookmarked);
    });

    // Card window requests folder list for its picker
    window.electronAPI.onGetBookmarkFolders(() => {
      const folders = Array.from(this.bookmarkFolders.values()).map(f => ({
        id: f.id,
        name: f.name,
        count: f.bookmarks.length
      }));
      window.electronAPI.sendBookmarkFolders(folders);
    });

    // Card window confirmed save - add bookmark to the chosen folder
    window.electronAPI.onSaveBookmarkToFolder((bookmarkData, folderId) => {
      const folder = this.bookmarkFolders.get(folderId);
      if (folder) {
        folder.bookmarks.push(bookmarkData);
        this.saveBookmarkFolders();
        this.renderBookmarks();
      }
    });

    // Password management
    this.passwords = []; // array of { site, username, password, timestamp }
    this.loadPasswords();

    // History management
    this.loadHistory();
    console.log('[HISTORY] Loaded from localStorage:', this.history.length, 'items');

    // Card window saves a password — persist and re-render
    window.electronAPI.onSavePassword((passwordData) => {
      const existingIndex = this.passwords.findIndex(
        p => p.site === passwordData.site && p.username === passwordData.username
      );
      if (existingIndex !== -1) {
        this.passwords[existingIndex] = passwordData;
      } else {
        this.passwords.push(passwordData);
      }
      this.savePasswords();
      this.renderPasswords();
    });

    // Settings tab switching
    const tabHistory = document.getElementById('settings-tab-history');
    const tabBookmarks = document.getElementById('settings-tab-bookmarks');
    const tabPasswords = document.getElementById('settings-tab-passwords');
    const tabDownloads = document.getElementById('settings-tab-downloads');
    const tabSearch = document.getElementById('settings-tab-search');
    const tabDeleteData = document.getElementById('settings-tab-delete-data');
    const paneHistory = document.getElementById('settings-history-tab');
    const paneBookmarks = document.getElementById('settings-bookmarks-tab');
    const panePasswords = document.getElementById('settings-passwords-tab');
    const paneDownloads = document.getElementById('settings-downloads-tab');
    const paneSearch = document.getElementById('settings-search-tab');
    const paneDeleteData = document.getElementById('settings-delete-data-tab');
    const deleteDataBtn = document.getElementById('delete-data-btn');
    const defaultBrowserBlock = document.getElementById('default-browser-setting');
    const setDefaultBrowserBtn = document.getElementById('set-default-browser-btn');

    // Default browser button: opens Windows Default Apps and tries to register protocols
    if (setDefaultBrowserBtn && window.electronAPI && window.electronAPI.setAsDefaultBrowser) {
      setDefaultBrowserBtn.addEventListener('click', async () => {
        setDefaultBrowserBtn.disabled = true;
        setDefaultBrowserBtn.textContent = 'Opening...';
        try {
          await window.electronAPI.setAsDefaultBrowser();
          setDefaultBrowserBtn.textContent = 'Check Windows settings';
          // After user visits Default Apps, re-check and hide if we're now default
          if (window.electronAPI.isDefaultBrowser && defaultBrowserBlock) {
            setTimeout(async () => {
              try {
                const isDefault = await window.electronAPI.isDefaultBrowser();
                if (isDefault) {
                  defaultBrowserBlock.style.display = 'none';
                }
              } catch (err) {
                console.error('Failed to re-check default browser status:', err);
              }
            }, 3000);
          }
        } catch (e) {
          console.error('Failed to trigger default browser setting:', e);
          setDefaultBrowserBtn.textContent = 'Try again';
        } finally {
          setTimeout(() => {
            setDefaultBrowserBtn.disabled = false;
          }, 2000);
        }
      });
    }

    // On load, hide the default-browser setting if we're already default
    if (defaultBrowserBlock && window.electronAPI && window.electronAPI.isDefaultBrowser) {
      window.electronAPI.isDefaultBrowser()
        .then((isDefault) => {
          if (isDefault) {
            defaultBrowserBlock.style.display = 'none';
          }
        })
        .catch((err) => {
          console.error('Failed to check default browser status:', err);
        });
    }

    // Helper: activate a settings tab by name
    this.activateSettingsTab = (tabName) => {
      const setActive = (btn, active) => {
        if (!btn) return;
        btn.style.background = active ? 'rgba(255,255,255,0.2)' : 'transparent';
        btn.style.color = active ? 'white' : 'rgba(255,255,255,0.6)';
        btn.style.fontWeight = active ? '600' : 'normal';
      };
      const setPane = (pane, show) => {
        if (!pane) return;
        pane.style.display = show ? 'block' : 'none';
      };

      this.currentSettingsTab = tabName || null;

      setActive(tabHistory, tabName === 'history');
      setActive(tabBookmarks, tabName === 'bookmarks');
      setActive(tabPasswords, tabName === 'passwords');
      setActive(tabDownloads, tabName === 'downloads');
      setActive(tabSearch, tabName === 'search');
      setActive(tabDeleteData, tabName === 'delete-data');

      setPane(paneHistory, tabName === 'history');
      setPane(paneBookmarks, tabName === 'bookmarks');
      setPane(panePasswords, tabName === 'passwords');
      setPane(paneDownloads, tabName === 'downloads');
      setPane(paneSearch, tabName === 'search');
      setPane(paneDeleteData, tabName === 'delete-data');

      if (tabName === 'history') this.renderHistory();
      if (tabName === 'passwords') this.renderPasswords();
      if (tabName === 'downloads') this.renderDownloadHistory();
    };

    const toggleSettingsTab = (tabName) => {
      if (this.currentSettingsTab === tabName) {
        this.activateSettingsTab(null);
      } else {
        this.activateSettingsTab(tabName);
      }
    };

    if (tabHistory && tabBookmarks && tabPasswords && tabDownloads && tabSearch && tabDeleteData) {
      tabHistory.addEventListener('click', () => {
        toggleSettingsTab('history');
      });
      
      tabBookmarks.addEventListener('click', () => {
        toggleSettingsTab('bookmarks');
      });
      
      tabPasswords.addEventListener('click', () => {
        toggleSettingsTab('passwords');
      });

      tabDownloads.addEventListener('click', () => {
        toggleSettingsTab('downloads');
      });

      tabSearch.addEventListener('click', () => {
        toggleSettingsTab('search');
      });

      tabDeleteData.addEventListener('click', () => {
        toggleSettingsTab('delete-data');
      });
    }

    if (deleteDataBtn) {
      deleteDataBtn.addEventListener('click', () => {
        this.clearAllUserData();
      });
    }

    // Listen for external URLs (when app is opened from outside)
    console.log('[RENDERER] Setting up external URL listener...');
    console.log('[RENDERER] electronAPI exists?', !!window.electronAPI);
    console.log('[RENDERER] electronAPI.onOpenUrl exists?', !!(window.electronAPI && window.electronAPI.onOpenUrl));
    
    if (window.electronAPI && window.electronAPI.onOpenUrl) {
      console.log('[RENDERER] Registering onOpenUrl listener');
      window.electronAPI.onOpenUrl((url) => {
        console.log('=== [RENDERER DEBUG] ===');
        console.log('[RENDERER-1] External URL callback fired');
        console.log('[RENDERER-2] URL received:', url);
        console.log('[RENDERER-3] URL type:', typeof url);
        console.log('[RENDERER-4] URL valid?', !!(url && typeof url === 'string'));
        
        try {
          if (!url || typeof url !== 'string') {
            console.error('[RENDERER-ERROR] Invalid URL received:', url);
            return;
          }
          
          console.log('[RENDERER-5] Validation passed');
          console.log('[RENDERER-6] this.createCard exists?', !!this.createCard);
          console.log('[RENDERER-7] Calling this.createCard with URL:', url);
          
          const result = this.createCard(url);
          
          console.log('[RENDERER-8] createCard returned:', result);
          console.log('[RENDERER-9] Successfully completed');
        } catch (err) {
          console.error('=== [RENDERER ERROR] ===');
          console.error('[RENDERER-ERROR] Exception caught:', err);
          console.error('[RENDERER-ERROR] Error message:', err.message);
          console.error('[RENDERER-ERROR] Error stack:', err.stack);
          console.error('=== [END ERROR] ===');
        }
        console.log('=== [END RENDERER DEBUG] ===\n');
      });
      console.log('[RENDERER] onOpenUrl listener registered successfully');
    } else {
      console.error('[RENDERER-ERROR] electronAPI.onOpenUrl not available!');
      console.error('[RENDERER-ERROR] electronAPI:', window.electronAPI);
    }
  }

  getSearchEngine() {
    return this.searchEngines.find(e => e.key === this.searchEngineKey) || this.searchEngines[0];
  }

  getSearchEngineHomeUrl() {
    const engine = this.getSearchEngine();
    return engine && engine.homeUrl ? engine.homeUrl : 'https://www.google.com';
  }

  buildSearchUrl(query) {
    const engine = this.getSearchEngine();
    const template = engine && engine.searchUrl ? engine.searchUrl : 'https://www.google.com/search?q={query}';
    return template.replace('{query}', encodeURIComponent(query));
  }

  loadSearchEngine() {
    try {
      const saved = localStorage.getItem('searchEngineKey');
      if (saved && this.searchEngines.some(e => e.key === saved)) {
        this.searchEngineKey = saved;
      }
    } catch (e) {}
  }

  setSearchEngine(key) {
    if (!this.searchEngines.some(e => e.key === key)) return;
    this.searchEngineKey = key;
    try {
      localStorage.setItem('searchEngineKey', key);
    } catch (e) {}
    this.applySearchEngineToUI();
  }

  populateSearchEngineSelect() {
    if (!this.searchEngineSelect) return;
    this.searchEngineSelect.innerHTML = '';
    this.searchEngines.forEach((engine) => {
      const opt = document.createElement('option');
      opt.value = engine.key;
      opt.textContent = engine.name;
      this.searchEngineSelect.appendChild(opt);
    });
  }

  applySearchEngineToUI() {
    const engine = this.getSearchEngine();
    if (this.searchEngineLabel) this.searchEngineLabel.textContent = engine.name || 'Search';
    if (this.searchEngineFavicon) {
      this.searchEngineFavicon.src = engine.favicon || 'https://www.google.com/favicon.ico';
      this.searchEngineFavicon.alt = engine.name || 'Search';
    }
    if (this.googleSearchInput) {
      this.googleSearchInput.placeholder = engine.placeholder || 'Search the web';
    }
    if (this.searchEngineSelect) {
      this.searchEngineSelect.value = engine.key;
    }
  }

  // Normalize URL - add https:// if protocol is missing, or convert to Google search
  normalizeUrl(url) {
    if (!url) return '';
    
    url = url.trim();
    
    // If already has a protocol, return as-is
    if (url.match(/^[a-zA-Z]+:\/\//)) {
      return url;
    }
    
    // Check if it looks like a search query (has spaces or no dots)
    // If it has spaces, it's definitely a search query
    if (url.includes(' ')) {
      return this.buildSearchUrl(url);
    }
    
    // If it has a dot and no spaces, treat it as a URL
    if (url.includes('.')) {
      return 'https://' + url;
    }
    
    // Single word without dots - treat as search query
    return this.buildSearchUrl(url);
  }

  // Extract domain name from URL for display
  extractDomainName(url) {
    try {
      const urlObj = new URL(url);
      let domain = urlObj.hostname;
      // Remove www. prefix if present
      domain = domain.replace(/^www\./, '');
      // Capitalize first letter
      return domain.charAt(0).toUpperCase() + domain.slice(1);
    } catch (e) {
      return 'New Site';
    }
  }

  // Get favicon URL for a given domain
  getFaviconUrl(url) {
    try {
      const urlObj = new URL(url);
      return `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`;
    } catch (e) {
      return '';
    }
  }

  // Add or update a tab for a visited site
  addOrUpdateTab(url, title) {
    console.log('addOrUpdateTab called with:', url, title);
    
    // First normalize the URL to ensure it has a protocol
    url = this.normalizeUrl(url);
    console.log('After normalizeUrl:', url);
    
    // ADD TO HISTORY HERE - same place as tabs!
    this.addToHistory(url, title);
    
    // Normalize URL (remove trailing slash, fragments)
    let normalizedUrl = url;
    try {
      const urlObj = new URL(url);
      normalizedUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
      if (normalizedUrl.endsWith('/') && urlObj.pathname === '/') {
        normalizedUrl = normalizedUrl.slice(0, -1);
      }
      console.log('Normalized URL:', normalizedUrl);
    } catch (e) {
      console.warn('Invalid URL:', url, e);
      return;
    }

    // Check if tab already exists
    if (this.visitedTabs.has(normalizedUrl)) {
      console.log('Updating existing tab');
      // Update existing tab
      const tabData = this.visitedTabs.get(normalizedUrl);
      tabData.title = title || this.extractDomainName(url);
      tabData.lastVisited = Date.now();
      this.visitedTabs.set(normalizedUrl, tabData);
    } else {
      console.log('Creating new tab, current count:', this.visitedTabs.size);
      // Check if we've reached max tabs
      if (this.visitedTabs.size >= this.maxTabs) {
        // Remove oldest tab (by lastVisited)
        let oldestUrl = null;
        let oldestTime = Infinity;
        
        for (const [tabUrl, tabData] of this.visitedTabs) {
          if (tabData.lastVisited < oldestTime) {
            oldestTime = tabData.lastVisited;
            oldestUrl = tabUrl;
          }
        }
        
        if (oldestUrl) {
          console.log('Removing oldest tab:', oldestUrl);
          this.visitedTabs.delete(oldestUrl);
        }
      }
      
      // Add new tab
      const tabData = {
        url: normalizedUrl,
        title: title || this.extractDomainName(url),
        favicon: this.getFaviconUrl(url),
        lastVisited: Date.now(),
        createdAt: Date.now()
      };
      
      console.log('Adding new tab:', tabData);
      this.visitedTabs.set(normalizedUrl, tabData);
    }
    
    this.saveTabs();
    this.renderTabs();
  }

  // Remove a tab
  removeTab(url) {
    this.visitedTabs.delete(url);
    this.saveTabs();
    this.renderTabs();
  }

  // Render all tabs
  renderTabs() {
    console.log('renderTabs called, tabs count:', this.visitedTabs.size);
    
    if (!this.tabsContainer) {
      console.warn('tabsContainer not found!');
      return;
    }
    
    this.tabsContainer.innerHTML = '';
    
    if (this.visitedTabs.size === 0) {
      this.tabsContainer.innerHTML = '<div class="tabs-empty">No sites visited yet</div>';
      this.updateTabCount();
      return;
    }
    
    // Sort tabs by last visited (most recent first)
    const sortedTabs = Array.from(this.visitedTabs.values())
      .sort((a, b) => b.lastVisited - a.lastVisited);
    
    console.log('Rendering tabs:', sortedTabs);
    
    sortedTabs.forEach(tabData => {
      const tabEl = this.createTabElement(tabData);
      this.tabsContainer.appendChild(tabEl);
    });
    
    this.updateTabCount();
  }

  // Create a tab element
  createTabElement(tabData) {
    const tabEl = document.createElement('div');
    tabEl.className = 'site-tab';
    tabEl.dataset.url = tabData.url;
    
    // Create favicon
    const favicon = document.createElement('div');
    favicon.className = 'tab-favicon';
    
    if (tabData.favicon) {
      const img = document.createElement('img');
      img.src = tabData.favicon;
      img.style.width = '16px';
      img.style.height = '16px';
      img.onerror = () => {
        // Fallback to first letter if favicon fails to load
        img.remove();
        favicon.textContent = tabData.title.charAt(0).toUpperCase();
      };
      favicon.appendChild(img);
    } else {
      favicon.textContent = tabData.title.charAt(0).toUpperCase();
    }
    
    // Create tab info
    const tabInfo = document.createElement('div');
    tabInfo.className = 'tab-info';
    
    const tabTitle = document.createElement('div');
    tabTitle.className = 'tab-title';
    tabTitle.textContent = tabData.title;
    
    const tabUrl = document.createElement('div');
    tabUrl.className = 'tab-url';
    try {
      const urlObj = new URL(tabData.url);
      tabUrl.textContent = urlObj.hostname;
    } catch (e) {
      tabUrl.textContent = tabData.url;
    }
    
    tabInfo.appendChild(tabTitle);
    tabInfo.appendChild(tabUrl);
    
    // Create close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'tab-close';
    closeBtn.innerHTML = '✕';
    closeBtn.title = 'Close tab';
    
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      tabEl.classList.add('removing');
      setTimeout(() => {
        this.removeTab(tabData.url);
      }, 300);
    });
    
    // Tab click handler - open or focus the card for this URL
    tabEl.addEventListener('click', () => {
      this.openOrFocusTabCard(tabData.url);
    });
    
    tabEl.appendChild(favicon);
    tabEl.appendChild(tabInfo);
    tabEl.appendChild(closeBtn);
    
    return tabEl;
  }

  // Open a card for a tab or focus existing one
  async openOrFocusTabCard(url) {
    // Check if a card with this URL already exists
    let existingCardId = null;
    
    for (const [cardId, cardData] of this.cards) {
      if (cardData.url === url) {
        existingCardId = cardId;
        break;
      }
    }
    
    if (existingCardId) {
      // Focus existing card
      this.focusCard(existingCardId);
      window.electronAPI.focusCard(existingCardId);
    } else {
      // Create new card
      await this.createCard(url);
    }
  }

  // Update tab count display
  updateTabCount() {
    if (this.tabCountSpan) {
      this.tabCountSpan.textContent = this.visitedTabs.size;
    }
  }

  // Save tabs to localStorage
  saveTabs() {
    try {
      const tabsArray = Array.from(this.visitedTabs.values());
      localStorage.setItem('visitedTabs', JSON.stringify(tabsArray));
    } catch (e) {
      console.warn('Failed to save tabs to localStorage:', e);
    }
  }

  // Load tabs from localStorage
  loadTabs() {
    try {
      const saved = localStorage.getItem('visitedTabs');
      if (saved) {
        const tabsArray = JSON.parse(saved);
        tabsArray.forEach(tabData => {
          this.visitedTabs.set(tabData.url, tabData);
        });
        this.renderTabs();
      }
    } catch (e) {
      console.warn('Failed to load tabs from localStorage:', e);
    }
  }

  toggleExtensions() {
    if (!this.extensionsPanel) return;
    
    const isHidden = this.extensionsPanel.getAttribute('aria-hidden') === 'true';
    
    // Close settings if open
    if (this.settingsPanel) {
      this.settingsPanel.setAttribute('aria-hidden', 'true');
      this.settingsPanel.style.display = 'none';
    }
    
    // Toggle extensions
    this.extensionsPanel.setAttribute('aria-hidden', String(!isHidden));
    this.extensionsPanel.style.display = isHidden ? 'block' : 'none';
  }

  toggleSettings() {
    if (!this.settingsPanel) return;
    
    const isHidden = this.settingsPanel.getAttribute('aria-hidden') === 'true';
    
    // Close extensions if open
    if (this.extensionsPanel) {
      this.extensionsPanel.setAttribute('aria-hidden', 'true');
      this.extensionsPanel.style.display = 'none';
    }

    // Close notifications if open
    if (this.notificationPanel) {
      this.notificationPanel.setAttribute('aria-hidden', 'true');
      this.notificationPanel.style.display = 'none';
    }
    
    // Toggle settings
    this.settingsPanel.setAttribute('aria-hidden', String(!isHidden));
    this.settingsPanel.style.display = isHidden ? 'block' : 'none';
    
    // Render history and bookmarks when opening settings
    if (isHidden) {
      // History is the first tab by default
      if (this.activateSettingsTab) {
        this.activateSettingsTab('history');
      } else {
        this.renderHistory();
      }
      this.renderBookmarks();
    }
  }

  toggleNotifications() {
    if (!this.notificationPanel) return;
    
    const isHidden = this.notificationPanel.getAttribute('aria-hidden') === 'true';

    // Close settings if open
    if (this.settingsPanel) {
      this.settingsPanel.setAttribute('aria-hidden', 'true');
      this.settingsPanel.style.display = 'none';
    }
    // Close extensions if open
    if (this.extensionsPanel) {
      this.extensionsPanel.setAttribute('aria-hidden', 'true');
      this.extensionsPanel.style.display = 'none';
    }

    this.notificationPanel.setAttribute('aria-hidden', String(!isHidden));
    this.notificationPanel.style.display = isHidden ? 'block' : 'none';
    if (isHidden) this.renderNotifications();
  }

  // ------------------------
  // Notifications Tray
  // ------------------------

  loadNotifications() {
    try {
      const saved = localStorage.getItem('notificationTray');
      if (saved) this.notifications = JSON.parse(saved) || [];
    } catch (e) {
      this.notifications = [];
    }
  }

  saveNotifications() {
    try {
      localStorage.setItem('notificationTray', JSON.stringify(this.notifications.slice(0, this.maxNotifications)));
    } catch (e) {}
  }

  seedDefaultNotifications() {
    const homeUrl = this.getSearchEngineHomeUrl();
    const bookmarksUrl = this.buildSearchUrl('browser bookmarks');
    const newsUrl = this.buildSearchUrl('today news');
    this.notifications = [
      { id: 'welcome', title: 'Welcome to Discovery', url: homeUrl, createdAt: Date.now() },
      { id: 'tips', title: 'Try bookmarks', url: bookmarksUrl, createdAt: Date.now() },
      { id: 'news', title: "Read today's news", url: newsUrl, createdAt: Date.now() }
    ];
    this.saveNotifications();
  }

  renderNotifications() {
    if (!this.notificationList) return;
    this.notificationList.innerHTML = '';

    if (!this.notifications || this.notifications.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'notification-empty';
      empty.textContent = 'No notifications';
      this.notificationList.appendChild(empty);
      return;
    }

    this.notifications.slice(0, this.maxNotifications).forEach((n) => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'notification-pill';
      pill.title = n.title || 'Notification';

      const dot = document.createElement('span');
      dot.className = 'notification-pill__dot';

      const label = document.createElement('span');
      label.textContent = n.title || 'Notification';

      pill.appendChild(dot);
      pill.appendChild(label);

      pill.addEventListener('click', () => {
        if (n.url) {
          this.createCard(n.url);
        }
      });

      this.notificationList.appendChild(pill);
    });
  }

  addNotification(title, url) {
    if (!title || !url) return;
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    this.notifications.unshift({ id, title, url, createdAt: Date.now() });
    this.notifications = this.notifications.slice(0, this.maxNotifications);
    this.saveNotifications();
    this.renderNotifications();
  }

  addNotificationFromWeb(payload) {
    if (!payload) return;
    const title = payload.title || 'Notification';
    const body = payload.body ? String(payload.body).trim() : '';
    const url = payload.url || '';
    const combinedTitle = body ? `${title}: ${body}` : title;
    if (!url) return;
    this.addNotification(combinedTitle, url);
  }

  // ------------------------
  // Downloads: ring + history
  // ------------------------

  loadDownloadHistory() {
    try {
      const saved = localStorage.getItem('downloadHistory');
      if (saved) this.downloadHistory = JSON.parse(saved) || [];
    } catch (e) {
      this.downloadHistory = [];
    }
  }

  saveDownloadHistory() {
    try {
      localStorage.setItem('downloadHistory', JSON.stringify(this.downloadHistory.slice(0, this.maxDownloadHistoryItems)));
    } catch (e) {}
  }

  formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let v = bytes;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  updateDownloadRing() {
    if (!this.downloadRingBtn) return;

    const active = Array.from(this.activeDownloads.values()).filter(d => d && d.state !== 'completed');
    if (active.length === 0) {
      this.downloadRingBtn.style.display = 'none';
      this.downloadRingBtn.setAttribute('aria-hidden', 'true');
      this.downloadRingBtn.classList.remove('indeterminate');
      return;
    }

    this.downloadRingBtn.style.display = 'inline-flex';
    this.downloadRingBtn.setAttribute('aria-hidden', 'false');

    let receivedSum = 0;
    let totalSum = 0;
    let hasTotal = true;
    active.forEach(d => {
      receivedSum += d.receivedBytes || 0;
      if (d.totalBytes && d.totalBytes > 0) {
        totalSum += d.totalBytes;
      } else {
        hasTotal = false;
      }
    });

    if (!hasTotal || totalSum <= 0) {
      this.downloadRingBtn.classList.add('indeterminate');
      this.downloadRingBtn.title = 'Downloading...';
      return;
    }

    this.downloadRingBtn.classList.remove('indeterminate');
    const progress = Math.max(0, Math.min(1, receivedSum / totalSum));
    const circumference = 97.4;
    const offset = circumference * (1 - progress);
    if (this.downloadRingFg) {
      this.downloadRingFg.style.strokeDashoffset = String(offset);
    }
    this.downloadRingBtn.title = `Downloading... ${Math.round(progress * 100)}%`;
  }

  onDownloadStarted(payload) {
    if (!payload || !payload.id) return;
    this.activeDownloads.set(payload.id, {
      ...payload,
      state: payload.state || 'progressing',
    });
    this.updateDownloadRing();
  }

  onDownloadProgress(payload) {
    if (!payload || !payload.id) return;
    const prev = this.activeDownloads.get(payload.id) || {};
    this.activeDownloads.set(payload.id, { ...prev, ...payload });
    this.updateDownloadRing();
  }

  onDownloadDone(payload) {
    if (!payload || !payload.id) return;
    const prev = this.activeDownloads.get(payload.id) || {};
    this.activeDownloads.delete(payload.id);
    this.updateDownloadRing();

    // Save to history (newest first)
    const entry = {
      id: payload.id,
      filename: payload.filename || prev.filename || 'download',
      url: payload.url || prev.url || '',
      savePath: payload.savePath || prev.savePath || '',
      receivedBytes: payload.receivedBytes ?? prev.receivedBytes ?? 0,
      totalBytes: payload.totalBytes ?? prev.totalBytes ?? 0,
      state: payload.state || 'completed',
      timestamp: payload.endTime || Date.now(),
    };
    this.downloadHistory.unshift(entry);
    this.downloadHistory = this.downloadHistory.slice(0, this.maxDownloadHistoryItems);
    this.saveDownloadHistory();
    this.renderDownloadHistory();
  }

  renderDownloadHistory() {
    if (!this.downloadsListEl) return;

    if (!this.downloadHistory || this.downloadHistory.length === 0) {
      this.downloadsListEl.innerHTML = `<div class="tabs-empty" style="height:auto; padding: 12px;">No downloads yet</div>`;
      return;
    }

    const rows = this.downloadHistory.slice(0, this.maxDownloadHistoryItems).map((d) => {
      const sizeText = (d.totalBytes && d.totalBytes > 0)
        ? `${this.formatBytes(d.receivedBytes)} / ${this.formatBytes(d.totalBytes)}`
        : `${this.formatBytes(d.receivedBytes)}`;
      const when = new Date(d.timestamp || Date.now()).toLocaleString();
      const status = d.state || 'completed';
      const pathText = d.savePath || '';
      const safeName = (d.filename || 'download').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const safeUrl = (d.url || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const safePath = pathText.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const btn = d.savePath
        ? `<button class="download-item__btn" data-action="show" data-path="${encodeURIComponent(d.savePath)}">Show</button>`
        : '';

      return `
        <div class="download-item">
          <div class="download-item__meta">
            <div class="download-item__name">${safeName}</div>
            <div class="download-item__sub">${status} • ${sizeText} • ${when}</div>
            <div class="download-item__sub">${safePath || safeUrl}</div>
          </div>
          <div class="download-item__actions">
            ${btn}
          </div>
        </div>
      `;
    }).join('');

    this.downloadsListEl.innerHTML = rows;

    // Wire action buttons
    this.downloadsListEl.querySelectorAll('button[data-action="show"]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const encoded = btn.getAttribute('data-path');
        if (!encoded) return;
        const filePath = decodeURIComponent(encoded);
        try {
          if (window.electronAPI && window.electronAPI.showItemInFolder) {
            await window.electronAPI.showItemInFolder(filePath);
          }
        } catch (err) {
          console.error('Failed to show item in folder:', err);
        }
      });
    });
  }

  // Bookmark folder management methods
  loadBookmarkFolders() {
    try {
      const saved = localStorage.getItem('bookmarkFolders');
      if (saved) {
        const foldersArray = JSON.parse(saved);
        foldersArray.forEach(folder => {
          this.bookmarkFolders.set(folder.id, folder);
          if (folder.id >= this.nextFolderId) {
            this.nextFolderId = folder.id + 1;
          }
        });
      }
      
      // Create default folder if none exist
      if (this.bookmarkFolders.size === 0) {
        this.createFolder('My Bookmarks');
      }

      // Initial sync to main process so card windows can read immediately
      this.saveBookmarkFolders();
    } catch (e) {
      console.warn('Failed to load bookmark folders:', e);
      this.createFolder('My Bookmarks');
    }
  }

  saveBookmarkFolders() {
    try {
      const foldersArray = Array.from(this.bookmarkFolders.values());
      localStorage.setItem('bookmarkFolders', JSON.stringify(foldersArray));
      // Sync to main process so card windows can read directly
      if (window.electronAPI && window.electronAPI.syncBookmarkFolders) {
        window.electronAPI.syncBookmarkFolders(foldersArray);
      }
    } catch (e) {
      console.warn('Failed to save bookmark folders:', e);
    }
  }

  createFolder(name) {
    const folderId = this.nextFolderId++;
    const folder = {
      id: folderId,
      name: name,
      bookmarks: [],
      expanded: true,
      createdAt: Date.now()
    };
    this.bookmarkFolders.set(folderId, folder);
    this.saveBookmarkFolders();
    return folderId;
  }

  createNewFolder() {
    this.showFolderModal('New Folder', 'New Folder', (folderName) => {
      if (folderName && folderName.trim()) {
        this.createFolder(folderName.trim());
        this.renderBookmarks();
      }
    });
  }

  renameFolder(folderId) {
    const folder = this.bookmarkFolders.get(folderId);
    if (!folder) return;
    
    this.showFolderModal('Rename Folder', folder.name, (newName) => {
      if (newName && newName.trim()) {
        folder.name = newName.trim();
        this.saveBookmarkFolders();
        this.renderBookmarks();
      }
    });
  }

  showFolderModal(title, defaultValue, callback) {
    const modal = document.getElementById('folder-modal');
    const titleEl = document.getElementById('folder-modal-title');
    const input = document.getElementById('folder-name-input');
    const okBtn = document.getElementById('folder-modal-ok');
    const cancelBtn = document.getElementById('folder-modal-cancel');
    
    if (!modal || !titleEl || !input || !okBtn || !cancelBtn) {
      console.error('Modal elements not found');
      return;
    }
    
    titleEl.textContent = title;
    input.value = defaultValue;
    modal.style.display = 'flex';
    
    // Focus input and select text
    setTimeout(() => {
      input.focus();
      input.select();
    }, 100);
    
    // Remove old listeners
    const newOkBtn = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOkBtn, okBtn);
    const newCancelBtn = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
    
    // OK button
    newOkBtn.addEventListener('click', () => {
      modal.style.display = 'none';
      callback(input.value);
    });
    
    // Cancel button
    newCancelBtn.addEventListener('click', () => {
      modal.style.display = 'none';
    });
    
    // Enter key
    const enterHandler = (e) => {
      if (e.key === 'Enter') {
        modal.style.display = 'none';
        callback(input.value);
        input.removeEventListener('keydown', enterHandler);
      } else if (e.key === 'Escape') {
        modal.style.display = 'none';
        input.removeEventListener('keydown', enterHandler);
      }
    };
    input.addEventListener('keydown', enterHandler);
  }

  deleteFolder(folderId) {
    const folder = this.bookmarkFolders.get(folderId);
    if (!folder) return;
    
    // Simple deletion - just delete it
    if (folder.bookmarks.length > 0) {
      // For now, just delete without complex confirmation
      console.log(`Deleting folder "${folder.name}" with ${folder.bookmarks.length} bookmarks`);
    }
    
    this.bookmarkFolders.delete(folderId);
    this.saveBookmarkFolders();
    this.renderBookmarks();
  }

  toggleFolder(folderId) {
    const folder = this.bookmarkFolders.get(folderId);
    if (folder) {
      folder.expanded = !folder.expanded;
      this.saveBookmarkFolders();
      this.renderBookmarks();
    }
  }

  loadBookmarks() {
    // Legacy support - no longer used, folders handle bookmarks
  }

  saveBookmarks() {
    // Legacy support - folders are saved instead
  }

  toggleBookmark(bookmarkData) {
    const url = bookmarkData.url;
    
    // This is now only called to REMOVE a bookmark (card handles add flow)
    for (const [folderId, folder] of this.bookmarkFolders) {
      const index = folder.bookmarks.findIndex(b => b.url === url);
      if (index !== -1) {
        folder.bookmarks.splice(index, 1);
        this.saveBookmarkFolders();
        this.renderBookmarks();
        return;
      }
    }
  }

  renderBookmarks() {
    const foldersList = document.getElementById('bookmarks-folders-list');
    if (!foldersList) return;
    
    foldersList.innerHTML = '';
    
    if (this.bookmarkFolders.size === 0) {
      return;
    }
    
    // Sort folders by creation date
    const sortedFolders = Array.from(this.bookmarkFolders.values())
      .sort((a, b) => a.createdAt - b.createdAt);
    
    sortedFolders.forEach(folder => {
      const folderEl = this.createFolderElement(folder);
      foldersList.appendChild(folderEl);
    });
  }

  createFolderElement(folder) {
    const folderEl = document.createElement('div');
    folderEl.className = 'bookmark-folder';
    folderEl.style.cssText = 'margin-bottom: 8px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; overflow: hidden;';
    
    // Folder header
    const folderHeader = document.createElement('div');
    folderHeader.style.cssText = 'display: flex; align-items: center; padding: 8px; cursor: pointer; background: rgba(255, 255, 255, 0.08);';
    
    folderHeader.innerHTML = `
      <span style="font-size: 14px; margin-right: 6px;">${folder.expanded ? '📂' : '📁'}</span>
      <span style="flex: 1; color: white; font-weight: 600; font-size: 12px;">${folder.name}</span>
      <span style="color: rgba(255,255,255,0.6); font-size: 10px; margin-right: 8px;">${folder.bookmarks.length}</span>
      <button class="folder-rename-btn" style="background: rgba(255,255,255,0.1); border: none; color: white; padding: 3px 6px; border-radius: 4px; font-size: 10px; cursor: pointer; margin-right: 4px;">✎</button>
      <button class="folder-delete-btn" style="background: rgba(255,100,100,0.6); border: none; color: white; padding: 3px 6px; border-radius: 4px; font-size: 10px; cursor: pointer;">✕</button>
    `;
    
    // Toggle folder on header click
    folderHeader.addEventListener('click', (e) => {
      if (e.target.classList.contains('folder-rename-btn') || e.target.classList.contains('folder-delete-btn')) {
        return;
      }
      this.toggleFolder(folder.id);
    });
    
    // Rename button
    folderHeader.querySelector('.folder-rename-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.renameFolder(folder.id);
    });
    
    // Delete button
    folderHeader.querySelector('.folder-delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.deleteFolder(folder.id);
    });
    
    folderEl.appendChild(folderHeader);
    
    // Folder content (bookmarks)
    if (folder.expanded && folder.bookmarks.length > 0) {
      const bookmarksContainer = document.createElement('div');
      bookmarksContainer.style.cssText = 'padding: 4px;';
      
      // Sort bookmarks by timestamp
      const sortedBookmarks = [...folder.bookmarks].sort((a, b) => b.timestamp - a.timestamp);
      
      sortedBookmarks.forEach(bookmark => {
        const bookmarkEl = this.createBookmarkElement(bookmark, folder.id);
        bookmarksContainer.appendChild(bookmarkEl);
      });
      
      folderEl.appendChild(bookmarksContainer);
    }
    
    return folderEl;
  }

  createBookmarkElement(bookmark, folderId) {
    const bookmarkItem = document.createElement('div');
    bookmarkItem.className = 'bookmark-item';
    bookmarkItem.style.cssText = 'display: flex; align-items: center; gap: 8px; padding: 6px 8px; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px; margin-bottom: 4px; transition: all 0.2s ease; cursor: pointer;';
    
    bookmarkItem.innerHTML = `
      <div class="bookmark-info" style="flex: 1; min-width: 0;">
        <div class="bookmark-title" style="color: white; font-weight: 600; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          ${bookmark.title || 'Untitled'}
        </div>
        <div class="bookmark-url" style="color: rgba(255,255,255,0.6); font-size: 9px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: monospace;">
          ${bookmark.url}
        </div>
      </div>
      <button class="bookmark-remove-btn" style="background: rgba(255,100,100,0.8); color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 11px; flex-shrink: 0;" title="Remove bookmark">✕</button>
    `;
    
    // Hover effects
    bookmarkItem.addEventListener('mouseenter', () => {
      bookmarkItem.style.background = 'rgba(255, 255, 255, 0.12)';
      bookmarkItem.style.borderColor = 'rgba(255, 255, 255, 0.2)';
    });
    
    bookmarkItem.addEventListener('mouseleave', () => {
      bookmarkItem.style.background = 'rgba(255, 255, 255, 0.08)';
      bookmarkItem.style.borderColor = 'rgba(255, 255, 255, 0.1)';
    });
    
    // Click to open bookmark
    const bookmarkInfo = bookmarkItem.querySelector('.bookmark-info');
    bookmarkInfo.addEventListener('click', () => {
      this.createCard(bookmark.url);
    });
    
    // Remove bookmark
    const removeBtn = bookmarkItem.querySelector('.bookmark-remove-btn');
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const folder = this.bookmarkFolders.get(folderId);
      if (folder) {
        const index = folder.bookmarks.findIndex(b => b.url === bookmark.url);
        if (index !== -1) {
          folder.bookmarks.splice(index, 1);
          this.saveBookmarkFolders();
          this.renderBookmarks();
        }
      }
    });
    
    removeBtn.addEventListener('mouseenter', () => {
      removeBtn.style.background = 'rgba(255, 67, 67, 0.95)';
      removeBtn.style.transform = 'scale(1.05)';
    });
    
    removeBtn.addEventListener('mouseleave', () => {
      removeBtn.style.background = 'rgba(255, 100, 100, 0.8)';
      removeBtn.style.transform = 'scale(1)';
    });
    
    return bookmarkItem;
  }

  // Password manager methods
  loadPasswords() {
    try {
      const saved = localStorage.getItem('savedPasswords');
      if (saved) {
        this.passwords = JSON.parse(saved);
      }
      // Initial sync to main process
      this.savePasswords();
    } catch (e) {
      console.warn('Failed to load passwords:', e);
    }
  }

  savePasswords() {
    try {
      localStorage.setItem('savedPasswords', JSON.stringify(this.passwords));
      if (window.electronAPI && window.electronAPI.syncPasswords) {
        window.electronAPI.syncPasswords(this.passwords);
      }
    } catch (e) {
      console.warn('Failed to save passwords:', e);
    }
  }

  renderPasswords() {
    const container = document.getElementById('passwords-list');
    if (!container) return;
    container.innerHTML = '';

    if (this.passwords.length === 0) {
      container.innerHTML = `<div style="color: rgba(255,255,255,0.35); font-size: 11px; text-align: center; padding: 24px 0;">No saved passwords</div>`;
      return;
    }

    // Sort newest first
    const sorted = [...this.passwords].sort((a, b) => b.timestamp - a.timestamp);

    sorted.forEach((entry, index) => {
      const item = document.createElement('div');
      item.style.cssText = 'display: flex; align-items: center; gap: 8px; padding: 7px 8px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; margin-bottom: 5px; transition: background 0.2s;';

      // Site icon + info
      let hostname = entry.site;
      try { hostname = new URL(entry.site).hostname; } catch(e) {}

      item.innerHTML = `
        <div style="width: 28px; height: 28px; border-radius: 6px; background: rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 13px;">🌐</div>
        <div class="pwd-info" style="flex: 1; min-width: 0;">
          <div class="pwd-site" style="color: white; font-size: 11px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${hostname}</div>
          <div class="pwd-username" style="color: rgba(255,255,255,0.5); font-size: 9.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${entry.username}</div>
        </div>
        <button class="pwd-copy-btn" style="background: rgba(100,200,100,0.5); border: 1px solid rgba(100,200,100,0.3); color: white; padding: 3px 7px; border-radius: 4px; font-size: 10px; cursor: pointer;" title="Copy password">📋</button>
        <button class="pwd-edit-btn" style="background: rgba(100,150,255,0.5); border: 1px solid rgba(100,150,255,0.3); color: white; padding: 3px 7px; border-radius: 4px; font-size: 10px; cursor: pointer;" title="Edit">✎</button>
        <button class="pwd-reveal-btn" style="background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.15); color: rgba(255,255,255,0.8); padding: 3px 7px; border-radius: 4px; font-size: 10px; cursor: pointer;" title="Show/hide password">👁</button>
        <button class="pwd-delete-btn" style="background: rgba(255,80,80,0.5); border: none; color: white; padding: 3px 7px; border-radius: 4px; font-size: 10px; cursor: pointer;" title="Delete">✕</button>
      `;

      // Hover
      item.addEventListener('mouseenter', () => { item.style.background = 'rgba(255,255,255,0.1)'; });
      item.addEventListener('mouseleave', () => { item.style.background = 'rgba(255,255,255,0.06)'; });

      // Copy password to clipboard
      const copyBtn = item.querySelector('.pwd-copy-btn');
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(entry.password).then(() => {
          const originalText = copyBtn.textContent;
          copyBtn.textContent = '✓';
          copyBtn.style.background = 'rgba(100,255,100,0.7)';
          setTimeout(() => {
            copyBtn.textContent = originalText;
            copyBtn.style.background = 'rgba(100,200,100,0.5)';
          }, 1500);
        }).catch(err => {
          console.error('Failed to copy password:', err);
        });
      });

      copyBtn.addEventListener('mouseenter', () => {
        copyBtn.style.background = 'rgba(100,200,100,0.7)';
      });
      copyBtn.addEventListener('mouseleave', () => {
        copyBtn.style.background = 'rgba(100,200,100,0.5)';
      });

      // Edit password entry
      const editBtn = item.querySelector('.pwd-edit-btn');
      editBtn.addEventListener('click', () => {
        this.showEditPasswordModal(entry);
      });

      editBtn.addEventListener('mouseenter', () => {
        editBtn.style.background = 'rgba(100,150,255,0.7)';
      });
      editBtn.addEventListener('mouseleave', () => {
        editBtn.style.background = 'rgba(100,150,255,0.5)';
      });

      // Reveal toggle — shows password in a small tooltip-style box below
      const revealBtn = item.querySelector('.pwd-reveal-btn');
      let revealed = false;
      let revealBox = null;

      revealBtn.addEventListener('click', () => {
        revealed = !revealed;
        if (revealed) {
          revealBox = document.createElement('div');
          revealBox.style.cssText = 'margin-top: 6px; padding: 5px 8px; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.15); border-radius: 5px; font-family: monospace; font-size: 11px; color: #a8f5a0; word-break: break-all; letter-spacing: 0.5px;';
          revealBox.textContent = entry.password;
          item.style.flexWrap = 'wrap';
          item.appendChild(revealBox);
          revealBtn.style.background = 'rgba(100,200,255,0.3)';
        } else {
          if (revealBox) { revealBox.remove(); revealBox = null; }
          item.style.flexWrap = 'nowrap';
          revealBtn.style.background = 'rgba(255,255,255,0.12)';
        }
      });

      // Delete
      const deleteBtn = item.querySelector('.pwd-delete-btn');
      deleteBtn.addEventListener('click', () => {
        this.passwords.splice(this.passwords.indexOf(entry), 1);
        this.savePasswords();
        this.renderPasswords();
      });

      deleteBtn.addEventListener('mouseenter', () => {
        deleteBtn.style.background = 'rgba(255,67,67,0.8)';
      });
      deleteBtn.addEventListener('mouseleave', () => {
        deleteBtn.style.background = 'rgba(255,80,80,0.5)';
      });

      container.appendChild(item);
    });
  }

  showEditPasswordModal(entry) {
    const modal = document.createElement('div');
    modal.id = 'edit-pwd-modal';
    modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 9999; display: flex; align-items: center; justify-content: center;';
    
    let hostname = entry.site;
    try { hostname = new URL(entry.site).hostname; } catch(e) {}
    
    modal.innerHTML = `
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; border-radius: 12px; width: 320px; box-shadow: 0 10px 40px rgba(0,0,0,0.5);">
        <h3 style="color: white; margin: 0 0 14px 0; font-size: 14px;">Edit Password for ${hostname}</h3>
        
        <label style="color: rgba(255,255,255,0.8); font-size: 11px; display: block; margin-bottom: 4px;">Username</label>
        <input type="text" id="edit-pwd-username" value="${entry.username}" style="width: 100%; padding: 8px; border: 1px solid rgba(255,255,255,0.3); border-radius: 6px; background: rgba(255,255,255,0.1); color: white; font-size: 12px; margin-bottom: 12px;">
        
        <label style="color: rgba(255,255,255,0.8); font-size: 11px; display: block; margin-bottom: 4px;">Password</label>
        <input type="text" id="edit-pwd-password" value="${entry.password}" style="width: 100%; padding: 8px; border: 1px solid rgba(255,255,255,0.3); border-radius: 6px; background: rgba(255,255,255,0.1); color: white; font-size: 12px; margin-bottom: 16px;">
        
        <div style="display: flex; gap: 8px; justify-content: flex-end;">
          <button id="edit-pwd-cancel" style="padding: 6px 12px; font-size: 11px; background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.3); border-radius: 6px; color: white; cursor: pointer;">Cancel</button>
          <button id="edit-pwd-save" style="padding: 6px 12px; font-size: 11px; background: rgba(255,255,255,0.25); border: 1px solid rgba(255,255,255,0.4); border-radius: 6px; color: white; cursor: pointer;">Save</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    const usernameInput = modal.querySelector('#edit-pwd-username');
    const passwordInput = modal.querySelector('#edit-pwd-password');
    const saveBtn = modal.querySelector('#edit-pwd-save');
    const cancelBtn = modal.querySelector('#edit-pwd-cancel');
    
    // Focus username field
    setTimeout(() => usernameInput.focus(), 100);
    
    // Save changes
    saveBtn.addEventListener('click', () => {
      entry.username = usernameInput.value.trim();
      entry.password = passwordInput.value;
      this.savePasswords();
      this.renderPasswords();
      modal.remove();
    });
    
    // Cancel
    cancelBtn.addEventListener('click', () => {
      modal.remove();
    });
    
    // Enter key saves
    const enterHandler = (e) => {
      if (e.key === 'Enter') {
        entry.username = usernameInput.value.trim();
        entry.password = passwordInput.value;
        this.savePasswords();
        this.renderPasswords();
        modal.remove();
      } else if (e.key === 'Escape') {
        modal.remove();
      }
    };
    usernameInput.addEventListener('keydown', enterHandler);
    passwordInput.addEventListener('keydown', enterHandler);
  }

  // ========================
  // History Management
  // ========================

  loadHistory() {
    try {
      const raw = localStorage.getItem('browsingHistory');
      if (raw) {
        this.history = JSON.parse(raw);
      }
    } catch (e) {
      console.error('Error loading history:', e);
      this.history = [];
    }
  }

  saveHistory() {
    try {
      // Limit to max items
      if (this.history.length > this.maxHistoryItems) {
        this.history = this.history.slice(0, this.maxHistoryItems);
      }
      localStorage.setItem('browsingHistory', JSON.stringify(this.history));
    } catch (e) {
      console.error('Error saving history:', e);
    }
  }

  addToHistory(url, title) {
    console.log('[HISTORY] addToHistory called with:', { url, title });
    
    // Don't add file:// URLs or duplicates from last 5 entries
    if (!url || url.startsWith('file://') || url.startsWith('about:')) {
      console.log('[HISTORY] Skipped - file:// or about: URL');
      return;
    }
    
    const recentDuplicate = this.history.slice(0, 5).find(h => h.url === url);
    if (recentDuplicate) {
      console.log('[HISTORY] Skipped - duplicate in recent 5');
      return;
    }

    const entry = {
      url: url,
      title: title || url,
      timestamp: Date.now(),
      favicon: this.getFaviconUrl(url)
    };

    console.log('[HISTORY] Adding entry:', entry);
    this.history.unshift(entry); // Add to beginning
    this.saveHistory();
    console.log('[HISTORY] History saved. Total items:', this.history.length);
  }

  getFaviconUrl(url) {
    try {
      const urlObj = new URL(url);
      return `${urlObj.protocol}//${urlObj.host}/favicon.ico`;
    } catch (e) {
      return '';
    }
  }

  clearHistory() {
    if (confirm('Clear all browsing history? This cannot be undone.')) {
      this.history = [];
      this.saveHistory();
      this.renderHistory();
    }
  }

  clearAllUserData() {
    const firstConfirm = confirm('Delete all app data? This will sign you out and cannot be undone.');
    if (!firstConfirm) return;
    const secondConfirm = confirm('Are you absolutely sure? This removes history, bookmarks, passwords, downloads, extensions, notifications, and tabs.');
    if (!secondConfirm) return;

    try {
      if (window.electronAPI && window.electronAPI.clearUserData) {
        window.electronAPI.clearUserData();
      }
    } catch (e) {
      console.warn('Failed to clear session data:', e);
    }

    try {
      localStorage.clear();
    } catch (e) {
      console.warn('Failed to clear localStorage:', e);
    }

    this.history = [];
    this.visitedTabs = new Map();
    this.passwords = [];
    this.downloadHistory = [];
    this.notifications = [];
    this.installedAddons = new Map();
    this.bookmarkFolders = new Map();
    this.searchEngineKey = 'google';

    try {
      if (window.electronAPI && window.electronAPI.syncPasswords) {
        window.electronAPI.syncPasswords([]);
      }
      if (window.electronAPI && window.electronAPI.updateAddons) {
        window.electronAPI.updateAddons([]);
      }
      if (window.electronAPI && window.electronAPI.syncBookmarkFolders) {
        window.electronAPI.syncBookmarkFolders([]);
      }
      if (window.electronAPI && window.electronAPI.setVisualizerEnabled) {
        window.electronAPI.setVisualizerEnabled(false);
      }
      const vizToggle = document.getElementById('visualizer-toggle');
      if (vizToggle) vizToggle.checked = false;
    } catch (e) {
      console.warn('Failed to sync cleared data:', e);
    }

    this.renderTabs();
    this.renderHistory();
    this.renderBookmarks();
    this.renderPasswords();
    this.renderDownloadHistory();
    this.renderNotifications();
    this.renderAddons();
    this.applySearchEngineToUI();

    alert('All local data has been deleted.');
  }

  renderHistory() {
    console.log('[HISTORY] renderHistory called. Total items:', this.history.length);
    const container = document.getElementById('history-list');
    if (!container) {
      console.log('[HISTORY] ERROR: history-list container not found!');
      return;
    }
    container.innerHTML = '';

    if (this.history.length === 0) {
      console.log('[HISTORY] No history items to display');
      container.innerHTML = `<div style="color: rgba(255,255,255,0.35); font-size: 11px; text-align: center; padding: 24px 0;">No browsing history</div>`;
      return;
    }

    console.log('[HISTORY] Rendering', this.history.length, 'items');

    // Group by date
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const groups = {
      today: [],
      yesterday: [],
      older: []
    };

    this.history.forEach(entry => {
      const entryDate = new Date(entry.timestamp);
      entryDate.setHours(0, 0, 0, 0);
      
      if (entryDate.getTime() === today.getTime()) {
        groups.today.push(entry);
      } else if (entryDate.getTime() === yesterday.getTime()) {
        groups.yesterday.push(entry);
      } else {
        groups.older.push(entry);
      }
    });

    // Render groups
    if (groups.today.length > 0) {
      this.renderHistoryGroup(container, 'Today', groups.today);
    }
    if (groups.yesterday.length > 0) {
      this.renderHistoryGroup(container, 'Yesterday', groups.yesterday);
    }
    if (groups.older.length > 0) {
      this.renderHistoryGroup(container, 'Older', groups.older);
    }

    // Clear history button handler
    const clearBtn = document.getElementById('clear-history-btn');
    if (clearBtn) {
      clearBtn.onclick = () => this.clearHistory();
    }
  }

  renderHistoryGroup(container, label, entries) {
    const groupHeader = document.createElement('div');
    groupHeader.style.cssText = 'color: rgba(255,255,255,0.5); font-size: 10px; font-weight: 600; margin: 8px 0 4px 0; text-transform: uppercase; letter-spacing: 0.5px;';
    groupHeader.textContent = label;
    container.appendChild(groupHeader);

    entries.forEach(entry => {
      const item = document.createElement('div');
      item.style.cssText = 'display: flex; align-items: center; gap: 8px; padding: 6px 8px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; margin-bottom: 4px; cursor: pointer; transition: background 0.2s;';

      const time = new Date(entry.timestamp);
      const timeStr = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

      let hostname = entry.url;
      try { hostname = new URL(entry.url).hostname; } catch(e) {}

      item.innerHTML = `
        <div style="width: 20px; height: 20px; border-radius: 4px; background: rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 11px;">🌐</div>
        <div style="flex: 1; min-width: 0;">
          <div style="color: white; font-size: 11px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${entry.title}</div>
          <div style="color: rgba(255,255,255,0.4); font-size: 9px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${hostname}</div>
        </div>
        <div style="color: rgba(255,255,255,0.3); font-size: 9px; flex-shrink: 0;">${timeStr}</div>
        <button class="history-delete-btn" style="background: rgba(255,80,80,0.4); border: none; color: white; padding: 3px 6px; border-radius: 4px; font-size: 9px; cursor: pointer; flex-shrink: 0;">✕</button>
      `;

      // Hover effects
      item.addEventListener('mouseenter', () => { 
        item.style.background = 'rgba(255,255,255,0.1)'; 
      });
      item.addEventListener('mouseleave', () => { 
        item.style.background = 'rgba(255,255,255,0.05)'; 
      });

      // Click to visit
      item.addEventListener('click', (e) => {
        if (!e.target.classList.contains('history-delete-btn')) {
          this.createCard(entry.url);
        }
      });

      // Delete individual entry
      const deleteBtn = item.querySelector('.history-delete-btn');
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const index = this.history.indexOf(entry);
        if (index > -1) {
          this.history.splice(index, 1);
          this.saveHistory();
          this.renderHistory();
        }
      });

      container.appendChild(item);
    });
  }

  loadAddons() {
    try {
      const raw = localStorage.getItem('installedAddons');
      if (raw) {
        const arr = JSON.parse(raw);
        arr.forEach(a => {
          // ensure enabled flag exists (default true)
          if (typeof a.enabled === 'undefined') a.enabled = true;
          this.installedAddons.set(a.name, a);
        });
      }
    } catch (e) {
      console.warn('Failed to load addons from storage', e);
    }
    this.renderAddons();
  }

  saveAddons() {
    try {
      const arr = Array.from(this.installedAddons.values());
      localStorage.setItem('installedAddons', JSON.stringify(arr));
      // Notify main process to apply addon changes (e.g., enable blocking)
      if (window.electronAPI && window.electronAPI.updateAddons) {
        try {
          window.electronAPI.updateAddons(arr);
        } catch (e) {
          console.warn('Failed to send addons to main process', e);
        }
      }
    } catch (e) {
      console.warn('Failed to save addons', e);
    }
  }

  renderAddons() {
    if (!this.addonsListEl) return;
    this.addonsListEl.innerHTML = '';
    const items = Array.from(this.installedAddons.values());
    if (this.noAddonsMsg) {
      this.noAddonsMsg.style.display = items.length ? 'none' : 'block';
    }
    items.forEach((meta) => {
      const name = meta.name || meta.url || 'Addon';
      const enabled = meta.enabled !== false;
      const card = document.createElement('div');
      card.className = 'addon-card';
      card.innerHTML = `
        <div class="addon-icon">${meta.icon || '🧩'}</div>
        <div class="addon-info">
          <h4>${name}</h4>
          <p>${meta.description || meta.url || ''}</p>
          <div class="addon-version">${enabled ? 'Enabled' : 'Disabled'}</div>
        </div>
        <div class="addon-controls">
          <button class="addon-toggle ${enabled ? 'enabled' : 'disabled'}" data-addon="${name}">${enabled ? 'On' : 'Off'}</button>
          <button class="btn uninstall-btn" data-addon="${name}">Remove</button>
        </div>
      `;
      const removeBtn = card.querySelector('.uninstall-btn');
      removeBtn.addEventListener('click', () => {
        this.installedAddons.delete(name);
        this.saveAddons();
        this.renderAddons();
      });
      const toggle = card.querySelector('.addon-toggle');
      toggle.addEventListener('click', () => {
        const current = this.installedAddons.get(name) || {};
        current.enabled = !current.enabled;
        this.installedAddons.set(name, current);
        this.saveAddons();
        this.renderAddons();
      });
      this.addonsListEl.appendChild(card);
    });
  }

  installAddon() {
    const name = (this.addonSearchInput && this.addonSearchInput.value || '').trim();
    if (!name) return alert('Please provide an addon name');
    this.installedAddons.set(name, { name, enabled: true, installedAt: Date.now() });
    this.saveAddons();
    this.renderAddons();
  }

  // Search GitHub repositories for the addon name and render quick results
  async searchAddons(query) {
    const q = (query || (this.addonSearchInput && this.addonSearchInput.value) || '').trim();
    if (!q) return alert('Type an addon name to search (e.g., uBlock Origin)');
    if (this.addonSearchResults) {
      this.addonSearchResults.innerHTML = '<div class="addon-search-result-card">Searching…</div>';
    }
    try {
      const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=6`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('Search failed');
      const data = await resp.json();
      const items = data.items || [];
      this.renderSearchResults(items);
    } catch (err) {
      console.error('Addon search error', err);
      if (this.addonSearchResults) {
        this.addonSearchResults.innerHTML = `<div class="addon-search-result-card">Search error: ${err.message}</div>`;
      }
    }
  }

  renderSearchResults(items) {
    if (!this.addonSearchResults) return;
    this.addonSearchResults.innerHTML = '';
    if (!items.length) {
      this.addonSearchResults.innerHTML = '<div class="addon-search-result-card">No results</div>';
      return;
    }
    items.forEach(repo => {
      const li = document.createElement('div');
      li.className = 'addon-search-result-card';
      const name = repo.full_name;
      const desc = repo.description || '';
      li.innerHTML = `
        <div>
          <h4>${name}</h4>
          <p>${desc}</p>
        </div>
        <div style="display:flex; gap:8px; margin-top:8px;">
          <button class="btn btn-primary" data-install-repo="${encodeURIComponent(repo.html_url)}">Install</button>
          <a class="btn" href="${repo.html_url}" target="_blank">Open</a>
        </div>
      `;
      const installBtn = li.querySelector('[data-install-repo]');
      installBtn.addEventListener('click', () => this.installFromSearch(repo));
      this.addonSearchResults.appendChild(li);
    });
  }

  // Install an addon from a GitHub repo result (register metadata only)
  installFromSearch(repo) {
    if (!repo || !repo.full_name) return;
    const name = repo.full_name;
    const url = repo.html_url;
    this.installedAddons.set(name, { name, url, description: repo.description || '', enabled: true, installedAt: Date.now() });
    this.saveAddons();
    this.renderAddons();
    alert('Installed addon: ' + name);
  }

  openAddonDiscovery(query = '') {
    if (!this.addonDiscoveryModal) return;
    this.addonDiscoveryModal.setAttribute('aria-hidden', 'false');
    this.addonDiscoveryModal.style.display = 'flex';
    if (this.addonSearchInput) {
      this.addonSearchInput.value = query || '';
      this.addonSearchInput.focus();
    }
    if (query) {
      this.searchAddons(query);
    } else if (this.addonSearchResults) {
      this.addonSearchResults.innerHTML = '';
    }
  }

  closeAddonDiscovery() {
    if (!this.addonDiscoveryModal) return;
    this.addonDiscoveryModal.setAttribute('aria-hidden', 'true');
    this.addonDiscoveryModal.style.display = 'none';
  }

  async createCard(url) {
    if (!url) {
      url = this.getSearchEngineHomeUrl();
    }
    console.log('=== [CREATE-CARD DEBUG] ===');
    console.log('[CREATE-1] createCard called');
    console.log('[CREATE-2] Input URL:', url);
    console.log('[CREATE-3] Input URL type:', typeof url);
    
    // Normalize URL to ensure it has https:// prefix
    const originalUrl = url;
    url = this.normalizeUrl(url);
    console.log('[CREATE-4] Normalized URL:', url);
    console.log('[CREATE-5] URL changed?', originalUrl !== url);
    
    const cardId = this.nextCardId++;
    console.log('[CREATE-6] Assigned cardId:', cardId);
    console.log('[CREATE-7] Current card count:', this.cards.size);
    
    // Calculate centered position on screen
    let x = 300;
    let y = 200;
    
    try {
      const screenWidth = window.screen.availWidth;
      const screenHeight = window.screen.availHeight;
      console.log('[CREATE-8] Screen size:', screenWidth, 'x', screenHeight);
      
      x = Math.floor((screenWidth - 650) / 2);
      y = Math.floor((screenHeight - 500) / 2);
      
      const cardCount = this.cards.size;
      if (cardCount > 0) {
        x += (cardCount * 25);
        y += (cardCount * 25);
      }
      console.log('[CREATE-9] Calculated position:', x, y);
    } catch (e) {
      console.warn('[CREATE-ERROR] Could not calculate centered position:', e);
    }

    const cardData = {
      id: cardId,
      url: url,
      title: this.extractDomainName(url),
      isActive: false,
    };
    console.log('[CREATE-10] Card data created:', cardData);

    this.cards.set(cardId, cardData);
    console.log('[CREATE-11] Card added to cards Map');
    console.log('[CREATE-12] Cards Map size now:', this.cards.size);

    try {
      console.log('[CREATE-13] Calling electronAPI.createCard...');
      console.log('[CREATE-14] Parameters:', { cardId, url, position: { x, y } });
      // Add tab immediately when card is created
      this.addOrUpdateTab(url, cardData.title);
      console.log('[CREATE-15] Tab added/updated');
      
      console.log('[CREATE-16] About to call window.electronAPI.createCard');
      const result = await window.electronAPI.createCard(cardId, url, { x, y });
      console.log('[CREATE-17] IPC call completed');
      console.log('[CREATE-18] Result:', result);
      console.log('[CREATE-19] Result.success:', result ? result.success : 'no result');
      
      console.log('[CREATE-20] Adding card to dock');
      this.addCardToDock(cardData);
      console.log('[CREATE-21] Updating card count');
      this.updateCardCount();
      console.log('[CREATE-22] Card creation completed successfully');
      console.log('=== [END CREATE-CARD DEBUG] ===\n');
    } catch (error) {
      console.error('=== [CREATE-CARD ERROR] ===');
      console.error('[CREATE-ERROR] Exception caught:', error);
      console.error('[CREATE-ERROR] Error message:', error.message);
      console.error('[CREATE-ERROR] Error stack:', error.stack);
      console.error('[CREATE-ERROR] Cleaning up - removing card from Map');
      this.cards.delete(cardId);
      console.error('=== [END ERROR] ===\n');
    }
  }

  navigateActiveCard(action) {
    if (!this.activeCardId) {
      console.log('No active card');
      return;
    }
    
    const cardId = this.activeCardId;
    
    switch(action) {
      case 'back':
        window.electronAPI.cardGoBack(cardId);
        break;
      case 'forward':
        window.electronAPI.cardGoForward(cardId);
        break;
      case 'reload':
        window.electronAPI.cardReload(cardId);
        break;
    }
  }

  addCardToDock(cardData) {
    // Skip if dock doesn't exist (using tab bar only)
    if (!this.cardDock) {
      return;
    }
    
    const dockItem = document.createElement('div');
    dockItem.className = 'dock-item';
    dockItem.id = `dock-${cardData.id}`;
    dockItem.title = cardData.title || 'New Tab';
    
    dockItem.innerHTML = `
      <div class="dock-item-content">
        <div class="dock-item-icon" style="background: linear-gradient(135deg, #667eea 0%, #f093fb 100%); border-radius: 8px; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; color: white; font-weight: 600;">
          ${cardData.id}
        </div>
        <button class="dock-close-btn" title="Close" data-card-id="${cardData.id}">✕</button>
      </div>
      <span class="dock-item-label" style="font-size: 11px; color: #999; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${cardData.title}</span>
    `;
    
    dockItem.addEventListener('click', (e) => {
      if (e.target.classList.contains('dock-close-btn')) {
        e.stopPropagation();
        return;
      }
      this.focusCard(cardData.id);
    });
    
    const closeBtn = dockItem.querySelector('.dock-close-btn');
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeCard(cardData.id);
    });
    
    dockItem.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.closeCard(cardData.id);
    });
    
    this.cardDock.appendChild(dockItem);
  }

  focusCard(cardId) {
    // Skip if dock doesn't exist (using tab bar only)
    if (!this.cardDock) {
      this.activeCardId = cardId;
      return;
    }
    
    const allDockItems = this.cardDock.querySelectorAll('.dock-item');
    allDockItems.forEach(item => item.classList.remove('active'));
    
    const dockItem = document.getElementById(`dock-${cardId}`);
    if (dockItem) {
      dockItem.classList.add('active');
    }
    
    this.activeCardId = cardId;
  }

  async closeCard(cardId) {
    try {
      await window.electronAPI.closeCard(cardId);
      this.removeCard(cardId);
    } catch (error) {
      console.error('Error closing card:', error);
    }
  }

  removeCard(cardId) {
    this.cards.delete(cardId);
    
    const dockItem = document.getElementById(`dock-${cardId}`);
    if (dockItem) {
      dockItem.remove();
    }
    
    if (this.activeCardId === cardId) {
      this.activeCardId = null;
    }
    
    this.updateCardCount();
  }

  updateCardTitle(cardId, title) {
    const cardData = this.cards.get(cardId);
    if (cardData) {
      cardData.title = title || 'New Tab';
      
      const dockItem = document.getElementById(`dock-${cardId}`);
      if (dockItem) {
        const label = dockItem.querySelector('.dock-item-label');
        if (label) {
          label.textContent = title || 'New Tab';
        }
        dockItem.title = title || 'New Tab';
      }
      
      // Update tab if exists
      if (cardData.url) {
        this.addOrUpdateTab(cardData.url, title);
      }
    }
  }

  updateCardUrl(cardId, url) {
    const cardData = this.cards.get(cardId);
    if (cardData) {
      // Normalize URL
      url = this.normalizeUrl(url);
      
      const oldUrl = cardData.url;
      cardData.url = url;
      
      // Add or update tab for new URL
      const title = cardData.title || this.extractDomainName(url);
      this.addOrUpdateTab(url, title);
    }
  }

  updateCardCount() {
    this.cardCountSpan.textContent = this.cards.size;
  }
}

// Initialize browser when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.discoveryBrowser = new DiscoveryBrowser();
});
