/**
 * Addon Manager Service
 * Handles addon CRUD, persistence, and lifecycle management
 */

class AddonService {
  constructor() {
    this.addons = new Map(); // id -> addon object
    this.storageKey = 'discovery_addons';
    this.load();
  }

  // Addon object structure:
  // {
  //   id: string (unique identifier)
  //   name: string
  //   description: string
  //   version: string
  //   enabled: boolean
  //   icon: string (URL or emoji)
  //   installDate: timestamp
  //   repository: string (GitHub URL)
  // }

  load() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        const arr = JSON.parse(raw);
        arr.forEach(a => {
          if (a && a.id) {
            this.addons.set(a.id, a);
          }
        });
      }
    } catch (e) {
      console.warn('Failed to load addons', e);
    }
  }

  save() {
    try {
      const arr = Array.from(this.addons.values());
      localStorage.setItem(this.storageKey, JSON.stringify(arr));
      return true;
    } catch (e) {
      console.error('Failed to save addons', e);
      return false;
    }
  }

  // Install addon from GitHub repo metadata
  installFromRepo(repo) {
    if (!repo || !repo.full_name) return null;
    
    const id = repo.full_name.replace(/\//g, '-').toLowerCase();
    const addon = {
      id,
      name: repo.name || repo.full_name,
      description: repo.description || 'No description',
      version: '1.0.0',
      enabled: true,
      icon: '🧩', // Default addon icon
      installDate: Date.now(),
      repository: repo.html_url,
    };
    
    this.addons.set(id, addon);
    this.save();
    return addon;
  }

  // Manually install addon with custom metadata
  install(name, repository, description = '') {
    const id = name.replace(/\s+/g, '-').toLowerCase();
    const addon = {
      id,
      name,
      description: description || `Custom addon: ${name}`,
      version: '1.0.0',
      enabled: true,
      icon: '🧩',
      installDate: Date.now(),
      repository: repository || '',
    };
    
    this.addons.set(id, addon);
    this.save();
    return addon;
  }

  // Toggle addon enabled state
  toggleAddon(id) {
    const addon = this.addons.get(id);
    if (addon) {
      addon.enabled = !addon.enabled;
      this.save();
      return addon;
    }
    return null;
  }

  // Uninstall addon
  uninstall(id) {
    const existed = this.addons.has(id);
    this.addons.delete(id);
    if (existed) this.save();
    return existed;
  }

  // Get all addons
  getAll() {
    return Array.from(this.addons.values());
  }

  // Get enabled addons
  getEnabled() {
    return Array.from(this.addons.values()).filter(a => a.enabled);
  }

  // Get addon by ID
  getById(id) {
    return this.addons.get(id);
  }
}

// Export singleton instance
const addonService = new AddonService();
