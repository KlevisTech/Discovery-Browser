// renderer-new.js
/**
 * Discovery Browser - Renderer Process (Rewritten)
 * Handles card management + professional addon management
 */

class DiscoveryBrowser {
  constructor() {
    this.cards = new Map();
    this.nextCardId = 1;
    this.activeCardId = null;
    this.nextCardX = 200;
    this.nextCardY = 150;
    this.init();
  }

  async init() {
    // Get DOM references
    this.cardDock = document.getElementById('dock-content');
    this.newCardBtn = document.getElementById('new-card-btn');
    this.cardCountSpan = document.getElementById('card-count');
    this.settingsBtn = document.getElementById('settings-btn');
    this.settingsPanel = document.getElementById('settings-panel');
    this.discoverBtn = document.getElementById('discover-addons-btn');
    this.discoveryModal = document.getElementById('addon-discovery-modal');
    this.closeModalBtn = document.getElementById('close-discovery-modal');
    this.addonSearchInput = document.getElementById('addon-search-input');
    this.addonSearchBtn = document.getElementById('addon-search-btn');
    this.addonSearchResults = document.getElementById('addon-search-results');
    this.installedAddonsGrid = document.getElementById('installed-addons-grid');
    this.noAddonsMsg = document.getElementById('no-addons-msg');

    // Setup card management
    const searchInput = document.getElementById('search-input');
    const backBtn = document.getElementById('main-back-btn');
    const forwardBtn = document.getElementById('main-forward-btn');
    const reloadBtn = document.getElementById('main-reload-btn');

    backBtn.addEventListener('click', () => this.navigateActiveCard('back'));
    forwardBtn.addEventListener('click', () => this.navigateActiveCard('forward'));
    reloadBtn.addEventListener('click', () => this.navigateActiveCard('reload'));

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const url = searchInput.value.trim();
        if (url) {
          this.createCard(url);
          searchInput.value = '';
        }
      }
    });

    this.newCardBtn.addEventListener('click', () => this.createCard('https://www.google.com'));

    // Setup addon management
    this.settingsBtn.addEventListener('click', () => this.toggleSettings());
    this.discoverBtn.addEventListener('click', () => this.openDiscoveryModal());
    this.closeModalBtn.addEventListener('click', () => this.closeDiscoveryModal());
    this.addonSearchBtn.addEventListener('click', () => this.searchAddons());
    this.addonSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.searchAddons();
    });

    // Close modal on overlay click
    document.getElementById('addon-discovery-modal').addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-overlay')) {
        this.closeDiscoveryModal();
      }
    });

    // Close settings panel when clicking outside
    document.addEventListener('click', (e) => {
      if (this.settingsPanel) {
        const isSettingsOpen = this.settingsPanel.getAttribute('aria-hidden') !== 'true' &&
          this.settingsPanel.style.display !== 'none';
        if (isSettingsOpen && !this.settingsPanel.contains(e.target) &&
          !e.target.closest('#settings-btn') && !e.target.closest('.settings-btn')) {
          this.settingsPanel.setAttribute('aria-hidden', 'true');
          this.settingsPanel.style.display = 'none';
        }
      }

      // Close addon discovery modal if clicking outside
      if (this.discoveryModal) {
        const isModalOpen = this.discoveryModal.getAttribute('aria-hidden') !== 'true' &&
          this.discoveryModal.style.display !== 'none';
        if (isModalOpen) {
          const modalContent = this.discoveryModal.querySelector('.addon-modal-content');
          const isClickInside = modalContent && modalContent.contains(e.target);
          const isClickOnCloseBtn = e.target.closest('#close-discovery-modal');
          const isClickOnDiscoverBtn = e.target.closest('#discover-addons-btn');

          if (!isClickInside && !isClickOnCloseBtn && !isClickOnDiscoverBtn) {
            this.closeDiscoveryModal();
          }
        }
      }
    });

    // Setup card events
    window.electronAPI.onCardClosed((cardId) => this.removeCard(cardId));
    window.electronAPI.onCardTitleUpdated((cardId, title) => this.updateCardTitle(cardId, title));
    window.electronAPI.onCardUrlUpdated((cardId, url) => this.updateCardUrl(cardId, url));

    // Render initial addon list
    this.renderInstalledAddons();

    // Notify main process of initial addon state
    this.notifyAddonUpdate();

    // Create initial Google card
    await this.createCard('https://www.google.com');

    // Listen for URLs coming from outside the app (Python, Clicks, etc.)
    window.electronAPI.onOpenUrl((url) => {
      console.log("Opening external URL in new card:", url);

      // Generate a unique ID (matching your existing card logic)
      const cardId = Date.now();

      // Use your existing logic to create a card
      // This usually involves calling the createCard IPC you already have
      window.electronAPI.createCard(cardId, url, { x: null, y: null })
        .then(result => {
          if (result.success) {
            // You might need to update your dock UI here
            // e.g., addCardToDock(cardId, url);
          }
        });
    });
  }

  toggleSettings() {
    if (!this.settingsPanel) return;
    const isHidden = this.settingsPanel.getAttribute('aria-hidden') === 'true';
    this.settingsPanel.setAttribute('aria-hidden', String(!isHidden));
    this.settingsPanel.style.display = isHidden ? 'block' : 'none';
    if (isHidden) {
      this.renderInstalledAddons();
    }
  }

  openDiscoveryModal() {
    this.discoveryModal.setAttribute('aria-hidden', 'false');
    this.discoveryModal.style.display = 'flex';
    this.addonSearchInput.focus();
  }

  closeDiscoveryModal() {
    this.discoveryModal.setAttribute('aria-hidden', 'true');
    this.discoveryModal.style.display = 'none';
    this.addonSearchResults.innerHTML = '';
  }

  async searchAddons() {
    const q = (this.addonSearchInput.value || '').trim();
    if (!q) return alert('Enter an addon name to search');

    this.addonSearchResults.innerHTML = '<p style="text-align:center;">Searching...</p>';
    try {
      const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=8&sort=stars`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('Search failed');
      const data = await resp.json();
      this.renderSearchResults(data.items || []);
    } catch (err) {
      console.error('Addon search error', err);
      this.addonSearchResults.innerHTML = `<p style="color:red;">Search failed: ${err.message}</p>`;
    }
  }

  renderSearchResults(items) {
    this.addonSearchResults.innerHTML = '';
    if (!items.length) {
      this.addonSearchResults.innerHTML = '<p style="text-align:center;">No results found.</p>';
      return;
    }

    items.forEach(repo => {
      const card = document.createElement('div');
      card.className = 'addon-search-result-card';
      card.innerHTML = `
        <div style="flex:1">
          <h4 style="margin-bottom:4px;">${repo.name}</h4>
          <p style="font-size:12px; opacity:0.8; margin-bottom:8px;">${repo.description || 'No description'}</p>
          <div style="font-size:11px; opacity:0.6;">⭐ ${repo.stargazers_count} | Updated: ${new Date(repo.updated_at).toLocaleDateString()}</div>
        </div>
        <button class="btn btn-primary" data-install-repo='${JSON.stringify(repo)}' style="width:80px;">Install</button>
      `;
      const btn = card.querySelector('[data-install-repo]');
      btn.addEventListener('click', () => {
        const addon = addonService.installFromRepo(repo);
        if (addon) {
          alert(`Installed: ${addon.name}`);
          this.renderInstalledAddons();
          this.notifyAddonUpdate();
        }
      });
      this.addonSearchResults.appendChild(card);
    });
  }

  renderInstalledAddons() {
    const addons = addonService.getAll();
    this.installedAddonsGrid.innerHTML = '';

    if (addons.length === 0) {
      this.noAddonsMsg.style.display = 'block';
      return;
    }

    this.noAddonsMsg.style.display = 'none';
    addons.forEach(addon => {
      const card = document.createElement('div');
      card.className = 'addon-card';
      card.innerHTML = `
        <div class="addon-icon">${addon.icon}</div>
        <div class="addon-info">
          <h4>${addon.name}</h4>
          <p>${addon.description}</p>
          <span class="addon-version">v${addon.version}</span>
        </div>
        <div class="addon-controls">
          <button class="addon-toggle ${addon.enabled ? 'enabled' : 'disabled'}" data-addon-id="${addon.id}">
            ${addon.enabled ? 'On' : 'Off'}
          </button>
          <button class="btn-remove" data-addon-id="${addon.id}">⊗</button>
        </div>
      `;

      const toggleBtn = card.querySelector('.addon-toggle');
      toggleBtn.addEventListener('click', () => {
        const updated = addonService.toggleAddon(addon.id);
        if (updated) {
          this.renderInstalledAddons();
          this.notifyAddonUpdate();
        }
      });

      const removeBtn = card.querySelector('.btn-remove');
      removeBtn.addEventListener('click', () => {
        if (confirm(`Uninstall ${addon.name}?`)) {
          addonService.uninstall(addon.id);
          this.renderInstalledAddons();
          this.notifyAddonUpdate();
        }
      });

      this.installedAddonsGrid.appendChild(card);
    });
  }

  notifyAddonUpdate() {
    // Notify main process of addon state changes
    const addons = addonService.getAll();
    if (window.electronAPI && window.electronAPI.updateAddons) {
      window.electronAPI.updateAddons(addons);
    }
  }

  // Card management methods (unchanged)
  async createCard(url = 'https://www.google.com') {
    const cardId = this.nextCardId++;
    const x = this.nextCardX;
    const y = this.nextCardY;

    this.nextCardX += 30;
    this.nextCardY += 30;
    if (this.nextCardX > 600) {
      this.nextCardX = 200;
      this.nextCardY = 150;
    }

    const cardData = {
      id: cardId,
      url: url,
      title: 'New Tab',
      isActive: false,
    };

    this.cards.set(cardId, cardData);

    try {
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
    switch (action) {
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

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.discoveryBrowser = new DiscoveryBrowser();
});

