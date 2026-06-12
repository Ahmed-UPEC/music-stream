// js/jellyfin-settings.js
//
// "Family Server" settings tab: change the Jellyfin connection (server URL +
// credentials) in-app instead of rebuilding the container, and show a live
// connection status — a dot + text in settings plus a small red indicator on
// the header avatar whenever the server stops responding.
import { MusicAPI } from './music-api.js';
import { showNotification } from './downloads.js';
import { t } from './i18n.js';

function jellyfin() {
    return MusicAPI.instance.jellyfinAPI;
}

function setHeaderIndicator(online) {
    const dot = document.getElementById('jellyfin-conn-indicator');
    if (dot) dot.style.display = online ? 'none' : '';
}

function renderStatus(state, detail = '') {
    const dot = document.getElementById('jellyfin-status-dot');
    const text = document.getElementById('jellyfin-status-text');
    if (dot) dot.dataset.state = state;
    if (!text) return;

    if (state === 'online') {
        text.textContent = detail ? `${t('Connected')} — ${detail}` : t('Connected');
    } else if (state === 'offline') {
        text.textContent = detail ? `${t('Server unreachable')} — ${detail}` : t('Server unreachable');
    } else {
        text.textContent = t('Checking connection...');
    }
}

// Ask the server-side broker first; fall back to pinging Jellyfin directly
// through the same-origin proxy when the broker isn't deployed.
async function fetchStatus() {
    try {
        const response = await fetch('/api/jellyfin/status');
        if (response.ok) return await response.json();
    } catch {
        // broker unavailable
    }
    try {
        const api = jellyfin();
        const response = await fetch(`${api.serverUrl}/System/Info/Public`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const info = await response.json();
        return { reachable: true, serverName: info.ServerName || '', version: info.Version || '' };
    } catch (error) {
        return { reachable: false, error: String(error?.message || error) };
    }
}

async function checkConnection() {
    renderStatus('checking');
    const status = await fetchStatus();
    if (status.reachable) {
        const label = [status.serverName, status.version].filter(Boolean).join(' ');
        renderStatus('online', label);
        setHeaderIndicator(true);
    } else {
        renderStatus('offline', status.error || '');
        setHeaderIndicator(false);
    }
    return status;
}

function updateAccountStatus() {
    const el = document.getElementById('jellyfin-account-status');
    if (!el) return;
    const username = jellyfin().username;
    el.textContent = username
        ? `${t('Signed in as')} ${username}`
        : t('Leave empty to use the family server login.');
}

export function initJellyfinSettings() {
    const urlInput = document.getElementById('jellyfin-server-url-input');
    const usernameInput = document.getElementById('jellyfin-username-input');
    const passwordInput = document.getElementById('jellyfin-password-input');
    const connectBtn = document.getElementById('jellyfin-connect-btn');
    const signoutBtn = document.getElementById('jellyfin-signout-btn');
    const refreshBtn = document.getElementById('jellyfin-status-refresh');

    // Header indicator follows live request results from the adapter
    window.addEventListener('jellyfin:connection-status', (event) => {
        const online = Boolean(event.detail?.online);
        setHeaderIndicator(online);
        renderStatus(online ? 'online' : 'offline');
    });

    if (!urlInput) return;

    try {
        urlInput.value = localStorage.getItem('jellyfin-server-url') || '';
        usernameInput.value = localStorage.getItem('jellyfin-username') || '';
    } catch {
        // ignore
    }
    updateAccountStatus();

    urlInput.addEventListener('change', () => {
        const value = urlInput.value.trim();
        try {
            if (value) localStorage.setItem('jellyfin-server-url', value);
            else localStorage.removeItem('jellyfin-server-url');
        } catch {
            // ignore
        }
        void jellyfin().clearCache();
        showNotification(t('Server URL saved.'));
        void checkConnection();
    });

    connectBtn?.addEventListener('click', async () => {
        const username = usernameInput.value.trim();
        const password = passwordInput.value;
        if (!username) {
            showNotification(t('Enter a username first.'));
            return;
        }
        connectBtn.disabled = true;
        try {
            await jellyfin().login(username, password);
            showNotification(t('Connected to the family server.'));
            updateAccountStatus();
            passwordInput.value = '';
            void checkConnection();
        } catch (error) {
            showNotification(`${t('Could not connect:')} ${error.message}`);
        } finally {
            connectBtn.disabled = false;
        }
    });

    signoutBtn?.addEventListener('click', () => {
        jellyfin().logout();
        usernameInput.value = '';
        passwordInput.value = '';
        updateAccountStatus();
        showNotification(t('Signed out.'));
    });

    refreshBtn?.addEventListener('click', () => void checkConnection());

    // Initial check happens lazily so app start isn't blocked
    setTimeout(() => void checkConnection(), 1500);
}
