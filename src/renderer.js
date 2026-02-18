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
    this.updateStatus = null;

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
    this.cardThemeKey = 'primary';
    this.cardThemes = [
      {
        key: 'primary',
        name: 'Nebula Blue',
        description: 'Original cool blue and violet glow.',
        preview: 'linear-gradient(135deg, rgba(102,126,234,0.58), rgba(240,147,251,0.58))',
      },
      {
        key: 'sunset',
        name: 'Rose Ember',
        description: 'Pink-red blend with warm neon energy.',
        preview: 'linear-gradient(135deg, rgba(255,80,150,0.56), rgba(255,70,70,0.56))',
      },
      {
        key: 'ocean',
        name: 'Tide Cyan',
        description: 'Aqua and royal blue glass effect.',
        preview: 'linear-gradient(135deg, rgba(0,198,255,0.55), rgba(0,114,255,0.52))',
      },
      {
        key: 'emerald',
        name: 'Emerald Mint',
        description: 'Fresh green and mint fusion.',
        preview: 'linear-gradient(135deg, rgba(17,153,142,0.56), rgba(56,239,125,0.5))',
      },
      {
        key: 'amber',
        name: 'Golden Flame',
        description: 'Amber-orange glow for warm contrast.',
        preview: 'linear-gradient(135deg, rgba(255,153,102,0.56), rgba(255,94,98,0.52))',
      },
      {
        key: 'midnight',
        name: 'Midnight Steel',
        description: 'Black graphite and charcoal glass.',
        preview: 'linear-gradient(135deg, rgba(10,10,12,0.78), rgba(35,35,42,0.72))',
      },
      {
        key: 'cocoa',
        name: 'Cocoa Earth',
        description: 'Brown espresso with warm bronze blend.',
        preview: 'linear-gradient(135deg, rgba(110,72,44,0.62), rgba(166,123,91,0.56))',
      },
    ];
    
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
    this.notificationsBadge = document.getElementById('notifications-badge');
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
    this.themeOptionsEl = document.getElementById('theme-options');
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
    this.loadCardTheme();
    this.applySearchEngineToUI();
    this.renderThemeOptions();
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
    await this.refreshUpdateStatus();
    this.renderNotifications();

    if (this.clearNotificationsBtn) {
      this.clearNotificationsBtn.textContent = 'Check now';
      this.clearNotificationsBtn.addEventListener('click', () => {
        this.refreshUpdateStatus().then(() => this.renderNotifications());
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
      // Notifications tray is now update-focused; ignore site notifications here.
      window.electronAPI.onNotificationReceived(() => {});
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

    // Password manager is disabled until secure OS-backed storage is implemented.
    this.passwords = [];
    this.loadPasswords();

    // History management
    this.loadHistory();

    // Card window saves a password - persist and re-render
    window.electronAPI.onSavePassword(() => {});

    // Settings tab switching
    const tabHistory = document.getElementById('settings-tab-history');
    const tabBookmarks = document.getElementById('settings-tab-bookmarks');
    const tabDownloads = document.getElementById('settings-tab-downloads');
    const tabSearch = document.getElementById('settings-tab-search');
    const tabThemes = document.getElementById('settings-tab-themes');
    const tabDeleteData = document.getElementById('settings-tab-delete-data');
    const paneHistory = document.getElementById('settings-history-tab');
    const paneBookmarks = document.getElementById('settings-bookmarks-tab');
    const paneDownloads = document.getElementById('settings-downloads-tab');
    const paneSearch = document.getElementById('settings-search-tab');
    const paneThemes = document.getElementById('settings-themes-tab');
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
      setActive(tabDownloads, tabName === 'downloads');
      setActive(tabSearch, tabName === 'search');
      setActive(tabThemes, tabName === 'themes');
      setActive(tabDeleteData, tabName === 'delete-data');

      setPane(paneHistory, tabName === 'history');
      setPane(paneBookmarks, tabName === 'bookmarks');
      setPane(paneDownloads, tabName === 'downloads');
      setPane(paneSearch, tabName === 'search');
      setPane(paneThemes, tabName === 'themes');
      setPane(paneDeleteData, tabName === 'delete-data');

      if (tabName === 'history') this.renderHistory();
      if (tabName === 'downloads') this.renderDownloadHistory();
      if (tabName === 'themes') this.renderThemeOptions();
    };

    const toggleSettingsTab = (tabName) => {
      if (this.currentSettingsTab === tabName) {
        this.activateSettingsTab(null);
      } else {
        this.activateSettingsTab(tabName);
      }
    };

    console.warn('[Settings] Tab buttons - History:', !!tabHistory, 'Bookmarks:', !!tabBookmarks, 'Downloads:', !!tabDownloads, 'Search:', !!tabSearch);
    if (tabHistory && tabBookmarks && tabDownloads && tabSearch && tabThemes && tabDeleteData) {
      tabHistory.addEventListener('click', () => {
        toggleSettingsTab('history');
      });
      
      tabBookmarks.addEventListener('click', () => {
        toggleSettingsTab('bookmarks');
      });
      
      tabDownloads.addEventListener('click', () => {
        toggleSettingsTab('downloads');
      });

      tabSearch.addEventListener('click', () => {
        toggleSettingsTab('search');
      });

      tabThemes.addEventListener('click', () => {
        toggleSettingsTab('themes');
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
    // Note: Cards are now created directly in main process for instant display
    // This handler is kept as a fallback
    if (window.electronAPI && window.electronAPI.onOpenUrl) {
      window.electronAPI.onOpenUrl((url) => {
        try {
          if (!url || typeof url !== 'string') {
            return;
          }
          // Card is already created directly in main process, no need to create again
          // Just update our internal tracking if needed
        } catch (err) {
          console.error('External URL open failed:', err);
        }
      });
    }

    // Listen for cards created directly from main process (instant external URL handling)
    if (window.electronAPI && window.electronAPI.onExternalCardCreated) {
      window.electronAPI.onExternalCardCreated((cardData) => {
        try {
          if (!cardData || !cardData.cardId) {
            return;
          }
          // Update internal card tracking
          const existingCard = this.cards.get(cardData.cardId);
          if (!existingCard) {
            // Add to our tracking
            this.cards.set(cardData.cardId, {
              id: cardData.cardId,
              url: cardData.url,
              title: cardData.title || 'Loading...',
              isActive: false,
            });
            // Update UI
            this.addOrUpdateTab(cardData.url, cardData.title || 'Loading...');
            this.addCardToDock({
              id: cardData.cardId,
              url: cardData.url,
              title: cardData.title || 'Loading...',
            });
            this.updateCardCount();
          }
        } catch (err) {
          console.error('Failed to track external card:', err);
        }
      });
    }

    if (window.electronAPI && window.electronAPI.onAuthOpenedExternally) {
      window.electronAPI.onAuthOpenedExternally((payload) => {
        this.showAuthRedirectNotice(payload || {});
      });
    }
  }

  showAuthRedirectNotice(payload = {}) {
    try {
      const authUrl = payload.authUrl || '';
      const launchUrl = payload.launchUrl || '';
      const requestId = payload.requestId || '';
      let host = '';
      try {
        host = authUrl ? new URL(authUrl).hostname : '';
      } catch (e) {}

      const sameTarget = !!(authUrl && launchUrl && authUrl === launchUrl);
      const message = sameTarget
        ? `Discovery Browser cannot complete secure sign-in for ${host || 'this site'} inside the app. Continue in Chrome/Edge?`
        : `Discovery Browser cannot complete secure sign-in inside the app. Continue in Chrome/Edge?`;

      const targetUrl = launchUrl || authUrl || this.getSearchEngineHomeUrl();
      this.addNotification(`External Sign-In Required: ${message}`, targetUrl);

      let accepted = false;
      try {
        accepted = confirm(message);
      } catch (e) {
        accepted = false;
      }

      if (!requestId || !window.electronAPI) {
        return;
      }

      if (accepted) {
        window.electronAPI.confirmAuthOpenExternal(requestId).then((result) => {
          if (!result || !result.success) {
            alert('Discovery Browser could not open Chrome/Edge. Please try again.');
          }
        }).catch(() => {
          alert('Discovery Browser could not open Chrome/Edge. Please try again.');
        });
      } else if (window.electronAPI.cancelAuthOpenExternal) {
        window.electronAPI.cancelAuthOpenExternal(requestId).catch(() => {});
      }
    } catch (e) {
      console.warn('Failed to show auth redirect notice:', e);
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

  loadCardTheme() {
    try {
      const saved = localStorage.getItem('cardThemeKey');
      if (saved && this.cardThemes.some(t => t.key === saved)) {
        this.cardThemeKey = saved;
      }
      // Sync theme to main process for external URL cards
      if (window.electronAPI && window.electronAPI.setCardTheme) {
        window.electronAPI.setCardTheme(this.cardThemeKey);
      }
    } catch (e) {}
  }

  setCardTheme(key) {
    if (!this.cardThemes.some(t => t.key === key)) return;
    this.cardThemeKey = key;
    try {
      localStorage.setItem('cardThemeKey', key);
      // Sync theme to main process for external URL cards
      if (window.electronAPI && window.electronAPI.setCardTheme) {
        window.electronAPI.setCardTheme(key);
      }
    } catch (e) {}
    this.renderThemeOptions();
    this.showThemeToast(key);
  }

  renderThemeOptions() {
    if (!this.themeOptionsEl) return;
    this.themeOptionsEl.innerHTML = '';
    this.cardThemes.forEach((theme) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `theme-option${this.cardThemeKey === theme.key ? ' is-selected' : ''}`;
      item.innerHTML = `
        <div class="theme-option__preview" style="background:${theme.preview};"></div>
        <div class="theme-option__name">${theme.name}</div>
        <div class="theme-option__desc">${theme.description}</div>
      `;
      item.addEventListener('click', () => this.setCardTheme(theme.key));
      this.themeOptionsEl.appendChild(item);
    });
  }

  showThemeToast(themeKey) {
    try {
      const theme = this.cardThemes.find((t) => t.key === themeKey);
      const name = theme ? theme.name : 'Theme';
      const toast = document.createElement('div');
      toast.style.cssText = 'position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: linear-gradient(135deg, #1f2430 0%, #2f3548 100%); color: white; padding: 8px 16px; border-radius: 14px; font-size: 11px; z-index: 10000; box-shadow: 0 6px 18px rgba(0,0,0,0.4); white-space: nowrap;';
      toast.textContent = `Theme set: ${name} (applies to new cards)`;
      document.body.appendChild(toast);
      setTimeout(() => {
        if (toast.parentNode) toast.remove();
      }, 1800);
    } catch (e) {}
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
    // First normalize the URL to ensure it has a protocol
    url = this.normalizeUrl(url);
    
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
    } catch (e) {
      return;
    }

    // Check if tab already exists
    if (this.visitedTabs.has(normalizedUrl)) {
      // Update existing tab
      const tabData = this.visitedTabs.get(normalizedUrl);
      tabData.title = title || this.extractDomainName(url);
      tabData.lastVisited = Date.now();
      this.visitedTabs.set(normalizedUrl, tabData);
    } else {
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
    if (!this.tabsContainer) {
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
    closeBtn.innerHTML = 'X';
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
    this.notifications = [];
  }

  saveNotifications() {
    return;
  }

  seedDefaultNotifications() {
    return;
  }

  async refreshUpdateStatus() {
    if (!window.electronAPI || !window.electronAPI.getUpdateStatus) {
      this.updateStatus = {
        success: false,
        currentVersion: 'unknown',
        latestVersion: '',
        isUpdateAvailable: false,
        updateUrl: 'https://gitlab.com/moderntechgroup/discovery-web/-/releases',
        updateMessage: 'Update service is unavailable in this build.',
      };
      this.updateNotificationsBadge();
      return;
    }
    try {
      const status = await window.electronAPI.getUpdateStatus();
      this.updateStatus = status || null;
      this.updateNotificationsBadge();
    } catch (e) {
      this.updateStatus = {
        success: false,
        currentVersion: 'unknown',
        latestVersion: '',
        isUpdateAvailable: false,
        updateUrl: 'https://gitlab.com/moderntechgroup/discovery-web/-/releases',
        updateMessage: 'Unable to check updates right now.',
      };
      this.updateNotificationsBadge();
    }
  }

  updateNotificationsBadge() {
    if (!this.notificationsBadge) return;
    const count = this.updateStatus && this.updateStatus.isUpdateAvailable ? 1 : 0;
    if (count > 0) {
      this.notificationsBadge.textContent = String(count);
      this.notificationsBadge.style.display = 'inline-block';
      if (this.notificationsBtn) {
        this.notificationsBtn.title = `Updates (${count} new)`;
      }
    } else {
      this.notificationsBadge.style.display = 'none';
      this.notificationsBadge.textContent = '0';
      if (this.notificationsBtn) {
        this.notificationsBtn.title = 'Updates';
      }
    }
  }

  renderNotifications() {
    if (!this.notificationList) return;
    this.notificationList.innerHTML = '';
    const status = this.updateStatus;
    const isUpdateAvailable = !!(status && status.isUpdateAvailable);
    const currentVersion = status && status.currentVersion ? status.currentVersion : 'unknown';
    const latestVersion = status && status.latestVersion ? status.latestVersion : currentVersion;
    const updateMessage = status && status.updateMessage
      ? status.updateMessage
      : (isUpdateAvailable ? 'New update available.' : 'You are running the latest version.');

    const card = document.createElement('div');
    card.className = 'notification-pill';
    card.style.display = 'block';
    card.style.cursor = 'default';
    card.style.textAlign = 'left';
    card.style.padding = '10px 12px';
    card.style.border = isUpdateAvailable
      ? '1px solid rgba(120, 230, 170, 0.5)'
      : '1px solid rgba(255,255,255,0.14)';
    card.style.background = isUpdateAvailable
      ? 'linear-gradient(135deg, rgba(24, 72, 52, 0.65), rgba(12, 40, 30, 0.65))'
      : 'rgba(255,255,255,0.08)';

    const headline = document.createElement('div');
    headline.style.color = 'white';
    headline.style.fontSize = '12px';
    headline.style.fontWeight = '600';
    headline.textContent = isUpdateAvailable ? 'Update Available' : 'Discovery is Up to Date';

    const versions = document.createElement('div');
    versions.style.color = 'rgba(255,255,255,0.75)';
    versions.style.fontSize = '10px';
    versions.style.marginTop = '4px';
    versions.textContent = `Current: ${currentVersion} • Latest: ${latestVersion}`;

    const message = document.createElement('div');
    message.style.color = 'rgba(255,255,255,0.82)';
    message.style.fontSize = '10px';
    message.style.marginTop = '6px';
    message.textContent = updateMessage;

    const actions = document.createElement('div');
    actions.style.marginTop = '10px';
    actions.style.display = 'flex';
    actions.style.gap = '8px';

    const checkBtn = document.createElement('button');
    checkBtn.type = 'button';
    checkBtn.className = 'btn';
    checkBtn.textContent = 'Check Again';
    checkBtn.style.padding = '4px 10px';
    checkBtn.style.fontSize = '10px';
    checkBtn.addEventListener('click', async () => {
      await this.refreshUpdateStatus();
      this.renderNotifications();
    });
    actions.appendChild(checkBtn);

    if (isUpdateAvailable) {
      const downloadBtn = document.createElement('button');
      downloadBtn.type = 'button';
      downloadBtn.className = 'btn btn-primary';
      downloadBtn.textContent = 'Download Update';
      downloadBtn.style.padding = '4px 10px';
      downloadBtn.style.fontSize = '10px';
      downloadBtn.addEventListener('click', async () => {
        if (window.electronAPI && window.electronAPI.openUpdateDownload) {
          await window.electronAPI.openUpdateDownload();
        }
      });
      actions.appendChild(downloadBtn);
    }

    card.appendChild(headline);
    card.appendChild(versions);
    card.appendChild(message);
    card.appendChild(actions);
    this.notificationList.appendChild(card);
  }

  addNotification(title, url) {
    return;
  }

  addNotificationFromWeb(payload) {
    return;
  }

  // ------------------------
  // Downloads: ring + history
  // ------------------------

  loadDownloadHistory() {
    try {
      this.downloadHistory = [];
      if (window.electronAPI && window.electronAPI.getDownloadHistory) {
        window.electronAPI.getDownloadHistory().then((result) => {
          console.warn('[Downloads] History fetch', result);
          // Merge main process history with local history to avoid race conditions
          const localHistory = this.downloadHistory.slice();
          if (result && result.success && Array.isArray(result.items)) {
            // Combine and deduplicate by id, prefer main process data
            const mainHistory = result.items;
            const mergedMap = new Map();
            // Add local items first (newer in-memory items)
            localHistory.forEach(item => {
              if (item && item.id) mergedMap.set(item.id, item);
            });
            // Then add main process items (will overwrite duplicates)
            mainHistory.forEach(item => {
              if (item && item.id) mergedMap.set(item.id, item);
            });
            // Convert back to array, sorted by timestamp descending
            this.downloadHistory = Array.from(mergedMap.values()).sort((a, b) => {
              return (b.timestamp || 0) - (a.timestamp || 0);
            });
            this.renderDownloadHistory();
          } else {
            const saved = localStorage.getItem('downloadHistory');
            if (saved) this.downloadHistory = JSON.parse(saved) || [];
            this.renderDownloadHistory();
          }
        }).catch(() => {
          const saved = localStorage.getItem('downloadHistory');
          if (saved) this.downloadHistory = JSON.parse(saved) || [];
          this.renderDownloadHistory();
        });
        return;
      }
      const saved = localStorage.getItem('downloadHistory');
      if (saved) this.downloadHistory = JSON.parse(saved) || [];
      this.renderDownloadHistory();
    } catch (e) {
      this.downloadHistory = [];
      this.renderDownloadHistory();
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
    console.warn('[Downloads] Started', payload);
    this.activeDownloads.set(payload.id, {
      ...payload,
      state: payload.state || 'progressing',
    });
    this.updateDownloadRing();
  }

  onDownloadProgress(payload) {
    if (!payload || !payload.id) return;
    console.warn('[Downloads] Progress', payload);
    const prev = this.activeDownloads.get(payload.id) || {};
    this.activeDownloads.set(payload.id, { ...prev, ...payload });
    this.updateDownloadRing();
  }

  onDownloadDone(payload) {
    console.warn('[Renderer] Download done received:', payload);
    if (!payload || !payload.id) return;
    console.warn('[Downloads] Done', payload);
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
    console.warn('[Downloads] Adding entry to history:', entry);
    this.downloadHistory.unshift(entry);
    this.downloadHistory = this.downloadHistory.slice(0, this.maxDownloadHistoryItems);
    console.warn('[Downloads] History after add:', this.downloadHistory.length, 'items');
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
            <div class="download-item__sub">${status} - ${sizeText} - ${when}</div>
            <div class="download-item__sub">${safePath || safeUrl}</div>
          </div>
          <div class="download-item__actions">
            ${btn}
          </div>
        </div>
      `;
    }).join('');

    this.downloadsListEl.innerHTML = rows;
    console.warn('[Downloads] Rendered', rows.length, 'items, HTML:', this.downloadsListEl.innerHTML.substring(0, 200));

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
      <span style="font-size: 11px; margin-right: 6px;">${folder.expanded ? 'OPEN' : 'FOLDER'}</span>
      <span style="flex: 1; color: white; font-weight: 600; font-size: 12px;">${folder.name}</span>
      <span style="color: rgba(255,255,255,0.6); font-size: 10px; margin-right: 8px;">${folder.bookmarks.length}</span>
      <button class="folder-rename-btn" style="background: rgba(255,255,255,0.1); border: none; color: white; padding: 3px 6px; border-radius: 4px; font-size: 10px; cursor: pointer; margin-right: 4px;">Edit</button>
      <button class="folder-delete-btn" style="background: rgba(255,100,100,0.6); border: none; color: white; padding: 3px 6px; border-radius: 4px; font-size: 10px; cursor: pointer;">X</button>
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
      <button class="bookmark-remove-btn" style="background: rgba(255,100,100,0.8); color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 11px; flex-shrink: 0;" title="Remove bookmark">X</button>
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
    this.passwords = [];
    try {
      localStorage.removeItem('savedPasswords');
    } catch (e) {}
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
    // Don't add file:// URLs or duplicates from last 5 entries
    if (!url || url.startsWith('file://') || url.startsWith('about:')) {
      return;
    }
    
    const recentDuplicate = this.history.slice(0, 5).find(h => h.url === url);
    if (recentDuplicate) {
      return;
    }

    const entry = {
      url: url,
      title: title || url,
      timestamp: Date.now(),
      favicon: this.getFaviconUrl(url)
    };

    this.history.unshift(entry); // Add to beginning
    this.saveHistory();
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
    this.cardThemeKey = 'primary';

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
    this.renderDownloadHistory();
    this.renderNotifications();
    this.renderAddons();
    this.applySearchEngineToUI();
    this.renderThemeOptions();

    alert('All local data has been deleted.');
  }

  renderHistory() {
    const container = document.getElementById('history-list');
    if (!container) {
      return;
    }
    container.innerHTML = '';

    if (this.history.length === 0) {
      container.innerHTML = `<div style="color: rgba(255,255,255,0.35); font-size: 11px; text-align: center; padding: 24px 0;">No browsing history</div>`;
      return;
    }

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
        <div style="width: 20px; height: 20px; border-radius: 4px; background: rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 10px;">WEB</div>
        <div style="flex: 1; min-width: 0;">
          <div style="color: white; font-size: 11px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${entry.title}</div>
          <div style="color: rgba(255,255,255,0.4); font-size: 9px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${hostname}</div>
        </div>
        <div style="color: rgba(255,255,255,0.3); font-size: 9px; flex-shrink: 0;">${timeStr}</div>
        <button class="history-delete-btn" style="background: rgba(255,80,80,0.4); border: none; color: white; padding: 3px 6px; border-radius: 4px; font-size: 9px; cursor: pointer; flex-shrink: 0;">X</button>
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
    // Ensure main process applies persisted addons on startup.
    try {
      const arr = Array.from(this.installedAddons.values());
      if (window.electronAPI && window.electronAPI.updateAddons) {
        window.electronAPI.updateAddons(arr);
      }
    } catch (e) {
      console.warn('Failed to apply persisted addons', e);
    }
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
        <div class="addon-icon">${meta.icon || '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M7 2h2v5h2V2h2v5a5 5 0 0 1 4 4.9v1.1h3v2h-3v1a5 5 0 0 1-4 4.9V22h-2v-3H9v3H7v-3.1a5 5 0 0 1-4-4.9v-1H0v-2h3v-1.1A5 5 0 0 1 7 7V2Zm0 7a3 3 0 0 0-3 3v1.1h10V12a3 3 0 0 0-3-3H7Z"/></svg>'}</div>
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
      this.addonSearchResults.innerHTML = '<div class="addon-search-result-card">Searching...</div>';
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
    
    // Normalize URL to ensure it has https:// prefix
    url = this.normalizeUrl(url);
    
    const cardId = this.nextCardId++;
    
    // Calculate centered position on screen
    let x = 300;
    let y = 200;
    
    try {
      const screenWidth = window.screen.availWidth;
      const screenHeight = window.screen.availHeight;
      
      x = Math.floor((screenWidth - 650) / 2);
      y = Math.floor((screenHeight - 500) / 2);
      
      const cardCount = this.cards.size;
      if (cardCount > 0) {
        x += (cardCount * 25);
        y += (cardCount * 25);
      }
    } catch (e) {
      // Keep defaults when screen metrics are unavailable.
    }

    const cardData = {
      id: cardId,
      url: url,
      title: this.extractDomainName(url),
      isActive: false,
    };
    this.cards.set(cardId, cardData);

    try {
      const result = await window.electronAPI.createCard(cardId, url, { x, y }, this.cardThemeKey);

      if (!result || !result.success) {
        this.cards.delete(cardId);
        this.updateCardCount();
        if (result && result.externalOpened) {
          return;
        }
        throw new Error((result && result.error) ? result.error : 'Card creation failed');
      }
      
      // Add tab only after main process confirms card creation.
      this.addOrUpdateTab(url, cardData.title);
      this.addCardToDock(cardData);
      this.updateCardCount();
    } catch (error) {
      console.error('Error creating card:', error);
      this.cards.delete(cardId);
    }
  }

  navigateActiveCard(action) {
    if (!this.activeCardId) {
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
        <button class="dock-close-btn" title="Close" data-card-id="${cardData.id}">X</button>
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
