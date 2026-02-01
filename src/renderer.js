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
    
    this.newCardBtn.addEventListener('click', () => this.createCard('https://www.google.com'));
    
    // Extensions and Settings panel elements
    this.extensionsBtn = document.getElementById('extensions-btn');
    this.settingsBtn = document.getElementById('settings-btn');
    this.extensionsPanel = document.getElementById('extensions-panel');
    this.settingsPanel = document.getElementById('settings-panel');
    
    this.installAddonBtn = document.getElementById('install-addon');
    this.addonNameInput = document.getElementById('addon-name');
    this.addonUrlInput = document.getElementById('addon-url');
    this.addonsListEl = document.getElementById('addons-list');
    this.searchAddonBtn = document.getElementById('search-addon');
    this.addonSearchResults = document.getElementById('addon-search-results');

    this.installedAddons = new Map();
    this.loadAddons();

    if (this.extensionsBtn) {
      this.extensionsBtn.addEventListener('click', () => this.toggleExtensions());
    }
    
    if (this.settingsBtn) {
      this.settingsBtn.addEventListener('click', () => this.toggleSettings());
    }
    
    // New folder button
    const newFolderBtn = document.getElementById('new-folder-btn');
    if (newFolderBtn) {
      newFolderBtn.addEventListener('click', () => this.createNewFolder());
    }
    
    if (this.installAddonBtn) {
      this.installAddonBtn.addEventListener('click', () => this.installAddon());
    }
    
    if (this.searchAddonBtn) {
      this.searchAddonBtn.addEventListener('click', () => this.searchAddons());
    }

    // Allow Enter key to trigger search/install
    if (this.addonNameInput) {
      this.addonNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.searchAddons();
      });
    }
    if (this.addonUrlInput) {
      this.addonUrlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.installAddon();
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
    const tabBookmarks = document.getElementById('settings-tab-bookmarks');
    const tabPasswords = document.getElementById('settings-tab-passwords');
    const paneBookmarks = document.getElementById('settings-bookmarks-tab');
    const panePasswords = document.getElementById('settings-passwords-tab');

    if (tabBookmarks && tabPasswords) {
      tabBookmarks.addEventListener('click', () => {
        tabBookmarks.style.background = 'rgba(255,255,255,0.2)';
        tabBookmarks.style.color = 'white';
        tabPasswords.style.background = 'transparent';
        tabPasswords.style.color = 'rgba(255,255,255,0.6)';
        paneBookmarks.style.display = 'block';
        panePasswords.style.display = 'none';
      });
      tabPasswords.addEventListener('click', () => {
        tabPasswords.style.background = 'rgba(255,255,255,0.2)';
        tabPasswords.style.color = 'white';
        tabBookmarks.style.background = 'transparent';
        tabBookmarks.style.color = 'rgba(255,255,255,0.6)';
        panePasswords.style.display = 'block';
        paneBookmarks.style.display = 'none';
        this.renderPasswords();
      });
    }

    // Listen for external URLs (when app is opened from outside)
    if (window.electronAPI && window.electronAPI.onOpenUrl) {
      window.electronAPI.onOpenUrl((url) => {
        console.log('External URL opened:', url);
        this.createCard(url);
      });
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
      return 'https://www.google.com/search?q=' + encodeURIComponent(url);
    }
    
    // If it has a dot and no spaces, treat it as a URL
    if (url.includes('.')) {
      return 'https://' + url;
    }
    
    // Single word without dots - treat as search query
    return 'https://www.google.com/search?q=' + encodeURIComponent(url);
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
    
    // Toggle settings
    this.settingsPanel.setAttribute('aria-hidden', String(!isHidden));
    this.settingsPanel.style.display = isHidden ? 'block' : 'none';
    
    // Render bookmarks when opening settings
    if (isHidden) {
      this.renderBookmarks();
    }
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
        <div style="flex: 1; min-width: 0;">
          <div style="color: white; font-size: 11px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${hostname}</div>
          <div style="color: rgba(255,255,255,0.5); font-size: 9.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${entry.username}</div>
        </div>
        <button class="pwd-reveal-btn" style="background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.15); color: rgba(255,255,255,0.8); padding: 3px 7px; border-radius: 4px; font-size: 10px; cursor: pointer;">👁</button>
        <button class="pwd-delete-btn" style="background: rgba(255,80,80,0.5); border: none; color: white; padding: 3px 7px; border-radius: 4px; font-size: 10px; cursor: pointer;">✕</button>
      `;

      // Hover
      item.addEventListener('mouseenter', () => { item.style.background = 'rgba(255,255,255,0.1)'; });
      item.addEventListener('mouseleave', () => { item.style.background = 'rgba(255,255,255,0.06)'; });

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
    for (const [name, meta] of this.installedAddons) {
      const li = document.createElement('li');
      li.className = 'addon-item';
      const enabled = meta.enabled !== false;
      li.innerHTML = `
        <div style="display:flex; gap:8px; align-items:center; flex:1">
          <span class="addon-name">${name}</span>
          <span class="addon-url">${meta.url || ''}</span>
        </div>
        <div style="display:flex; gap:8px; align-items:center">
          <button class="addon-toggle ${enabled ? 'on' : 'off'}" data-addon="${name}">${enabled ? 'On' : 'Off'}</button>
          <button class="uninstall-btn" data-addon="${name}">Remove</button>
        </div>
      `;
      const btn = li.querySelector('.uninstall-btn');
      btn.addEventListener('click', () => {
        this.installedAddons.delete(name);
        this.saveAddons();
        this.renderAddons();
      });
      const toggle = li.querySelector('.addon-toggle');
      toggle.addEventListener('click', () => {
        const current = this.installedAddons.get(name) || {};
        current.enabled = !current.enabled;
        this.installedAddons.set(name, current);
        this.saveAddons();
        this.renderAddons();
      });
      this.addonsListEl.appendChild(li);
    }
  }

  installAddon() {
    const name = (this.addonNameInput.value || '').trim();
    const url = (this.addonUrlInput.value || '').trim();
    if (!name) return alert('Please provide an addon name');
    // For now we only register the addon metadata; actual addon execution is out of scope
    this.installedAddons.set(name, { name, url, installedAt: Date.now() });
    this.saveAddons();
    this.renderAddons();
    this.addonNameInput.value = '';
    this.addonUrlInput.value = '';
  }

  // Search GitHub repositories for the addon name and render quick results
  async searchAddons() {
    const q = (this.addonNameInput.value || '').trim();
    if (!q) return alert('Type an addon name to search (e.g., uBlock Origin)');
    this.addonSearchResults.innerHTML = '<li class="addon-item">Searching…</li>';
    try {
      const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=6`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('Search failed');
      const data = await resp.json();
      const items = data.items || [];
      this.renderSearchResults(items);
    } catch (err) {
      console.error('Addon search error', err);
      this.addonSearchResults.innerHTML = `<li class="addon-item">Search error: ${err.message}</li>`;
    }
  }

  renderSearchResults(items) {
    this.addonSearchResults.innerHTML = '';
    if (!items.length) {
      this.addonSearchResults.innerHTML = '<li class="addon-item">No results</li>';
      return;
    }
    items.forEach(repo => {
      const li = document.createElement('li');
      li.className = 'addon-item';
      const name = repo.full_name;
      const desc = repo.description || '';
      li.innerHTML = `
        <div style="flex:1">
          <div style="font-weight:600">${name}</div>
          <div style="font-size:12px; opacity:0.8">${desc}</div>
        </div>
        <div style="margin-left:8px; display:flex; gap:6px">
          <button class="btn" data-install-repo="${encodeURIComponent(repo.html_url)}">Install</button>
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
    this.installedAddons.set(name, { name, url, installedAt: Date.now() });
    this.saveAddons();
    this.renderAddons();
    alert('Installed addon: ' + name);
  }

  async createCard(url = 'https://www.google.com') {
    // Normalize URL to ensure it has https:// prefix
    url = this.normalizeUrl(url);
    console.log('createCard called with URL:', url);
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
      console.warn('Could not calculate centered position:', e);
    }

    const cardData = {
      id: cardId,
      url: url,
      title: this.extractDomainName(url),
      isActive: false,
    };

    this.cards.set(cardId, cardData);

    try {
      // Add tab immediately when card is created
      this.addOrUpdateTab(url, cardData.title);
      
      await window.electronAPI.createCard(cardId, url, { x, y });
      
      this.addCardToDock(cardData);
      this.updateCardCount();
    } catch (error) {
      console.error('Error creating card:', error);
      this.cards.delete(cardId);
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