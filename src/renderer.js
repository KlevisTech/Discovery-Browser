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
    
    // Layout constants
    this.headerBarHeight = 88;
    this.cardWidth = 650;
    this.cardHeight = 500;
    
    // Container references
    this.cardDock = document.getElementById('dock-content');
    this.newCardBtn = document.getElementById('new-card-btn');
    this.cardCountSpan = document.getElementById('card-count');
    
    // Initial position for new windows
    this.nextCardX = 200;
    this.nextCardY = 150;
    
    this.init();
  }

  async init() {
    // Setup event listeners
    const searchInput = document.getElementById('search-input');
    
    // Navigation buttons in main window
    const backBtn = document.getElementById('main-back-btn');
    const forwardBtn = document.getElementById('main-forward-btn');
    const reloadBtn = document.getElementById('main-reload-btn');
    
    // Navigation button handlers
    backBtn.addEventListener('click', () => this.navigateActiveCard('back'));
    forwardBtn.addEventListener('click', () => this.navigateActiveCard('forward'));
    reloadBtn.addEventListener('click', () => this.navigateActiveCard('reload'));
    
    // Search input handler - create card on Enter key
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const url = searchInput.value.trim();
        if (url) {
          this.createCard(url);
          searchInput.value = ''; // Clear input after creating card
        }
      }
    });
    
    this.newCardBtn.addEventListener('click', () => this.createCard('https://www.google.com'));
    // Settings panel elements
    this.settingsBtn = document.getElementById('settings-btn');
    this.settingsPanel = document.getElementById('settings-panel');
    this.installAddonBtn = document.getElementById('install-addon');
    this.addonNameInput = document.getElementById('addon-name');
    this.addonUrlInput = document.getElementById('addon-url');
    this.addonsListEl = document.getElementById('addons-list');
    this.searchAddonBtn = document.getElementById('search-addon');
    this.addonSearchResults = document.getElementById('addon-search-results');

    this.installedAddons = new Map();
    this.loadAddons();

    this.settingsBtn.addEventListener('click', () => this.toggleSettings());
    this.installAddonBtn.addEventListener('click', () => this.installAddon());
    this.searchAddonBtn.addEventListener('click', () => this.searchAddons());

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
    
    // Create initial Google card
    await this.createCard('https://www.google.com');
  }

  toggleSettings() {
    if (!this.settingsPanel) return;
    const isHidden = this.settingsPanel.getAttribute('aria-hidden') === 'true';
    this.settingsPanel.setAttribute('aria-hidden', String(!isHidden));
    this.settingsPanel.style.display = isHidden ? 'block' : 'none';
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
  const cardId = this.nextCardId++;
  
  // Calculate centered position on screen
  let x = 300; // Default fallback
  let y = 200; // Default fallback
  
  try {
    // Get screen dimensions for proper centering
    const screenWidth = window.screen.availWidth;
    const screenHeight = window.screen.availHeight;
    
    // Center the card
    x = Math.floor((screenWidth - 650) / 2);
    y = Math.floor((screenHeight - 500) / 2);
    
    // Add slight offset for each new card so they don't stack exactly
    const cardCount = this.cards.size;
    if (cardCount > 0) {
      x += (cardCount * 25); // Offset 25px right
      y += (cardCount * 25); // Offset 25px down
    }
  } catch (e) {
    console.warn('Could not calculate centered position:', e);
  }

  // Create card data object
  const cardData = {
    id: cardId,
    url: url,
    title: 'New Tab',
    isActive: false,
  };

  this.cards.set(cardId, cardData);

  // Request main process to create floating window
  try {
    await window.electronAPI.createCard(cardId, url, { x, y });
    
    // Add to dock
    this.addCardToDock(cardData);
    
    // Update card count
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
    const dockItem = document.createElement('div');
    dockItem.className = 'dock-item';
    dockItem.id = `dock-${cardData.id}`;
    dockItem.title = cardData.title || 'New Tab';
    
    // Icon placeholder with close button
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
    // Mark as active in dock
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
    }
  }

  updateCardUrl(cardId, url) {
    const cardData = this.cards.get(cardId);
    if (cardData) {
      cardData.url = url;
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
