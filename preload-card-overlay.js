
//preload-card-overlay.js
const { contextBridge, ipcRenderer } = require('electron');

// Expose card API for navigation
contextBridge.exposeInMainWorld('cardAPI', {
  cardGoBack: (cardId) => 
    ipcRenderer.invoke('card-go-back', cardId),
  
  cardGoForward: (cardId) => 
    ipcRenderer.invoke('card-go-forward', cardId),
  
  cardReload: (cardId) => 
    ipcRenderer.invoke('card-reload', cardId),

  closeCard: (cardId) => 
    ipcRenderer.invoke('close-card', cardId),

  getWindowPosition: () => {
    return {
      x: window.screenX,
      y: window.screenY,
    };
  },

  updateWindowPosition: (x, y, cardId) => 
    ipcRenderer.invoke('update-card-position', cardId, x, y),
});

// Inject navigation UI overlay when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  injectNavigationOverlay();
});

function injectNavigationOverlay() {
  // Get card ID from query params or window name
  const params = new URLSearchParams(window.location.search);
  let cardId = params.get('cardId');
  
  // If no cardId in params, try to get it from the window name set by main process
  if (!cardId && window.name) {
    try {
      const windowData = JSON.parse(window.name);
      cardId = windowData.cardId;
    } catch (e) {
      // Window name not JSON, ignore
    }
  }

  if (!cardId) {
    console.warn('No cardId found for navigation overlay');
    return;
  }

  // Create navigation bar HTML
  const navBar = document.createElement('div');
  navBar.id = 'card-nav-overlay';
  navBar.innerHTML = `
    <style>
      #card-nav-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        height: 50px;
        background: linear-gradient(135deg, rgba(102, 126, 234, 0.3), rgba(240, 147, 251, 0.3));
        backdrop-filter: blur(10px);
        border-bottom: 2px solid rgba(255, 255, 255, 0.2);
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 12px;
        z-index: 9999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }

      .nav-btn-overlay {
        width: 32px;
        height: 32px;
        border-radius: 6px;
        border: none;
        background: rgba(255, 255, 255, 0.15);
        color: white;
        cursor: pointer;
        font-size: 14px;
        font-weight: 600;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
      }

      .nav-btn-overlay:hover {
        background: rgba(255, 255, 255, 0.25);
        transform: scale(1.05);
      }

      .nav-btn-overlay:active {
        background: rgba(255, 255, 255, 0.35);
        transform: scale(0.95);
      }

      .nav-btn-overlay:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      #close-btn-overlay {
        width: 32px;
        height: 32px;
        background: rgba(255, 100, 100, 0.7);
        margin-left: auto;
      }

      #close-btn-overlay:hover {
        background: rgba(255, 67, 67, 0.9);
      }
    </style>

    <button class="nav-btn-overlay" id="back-btn-overlay" title="Back">←</button>
    <button class="nav-btn-overlay" id="forward-btn-overlay" title="Forward">→</button>
    <button class="nav-btn-overlay" id="reload-btn-overlay" title="Reload">↻</button>
    <button class="nav-btn-overlay" id="close-btn-overlay" title="Close">✕</button>
  `;

  document.body.insertBefore(navBar, document.body.firstChild);

  // Add padding to body so content doesn't hide behind nav
  document.body.style.paddingTop = '50px';

  // Add button event listeners
  document.getElementById('back-btn-overlay').addEventListener('click', () => {
    window.history.back();
  });

  document.getElementById('forward-btn-overlay').addEventListener('click', () => {
    window.history.forward();
  });

  document.getElementById('reload-btn-overlay').addEventListener('click', () => {
    window.location.reload();
  });

  document.getElementById('close-btn-overlay').addEventListener('click', () => {
    if (window.cardAPI) {
      window.cardAPI.closeCard(cardId);
    }
  });
}
