// js/pwa-install.js
//
// "Add to Home Screen" install prompt. Browsers fire `beforeinstallprompt`
// when the PWA is installable but never show UI on their own in most mobile
// browsers — this captures the event and offers a small install banner once.
import { t } from './i18n.js';

const DISMISSED_KEY = 'pwa-install-dismissed';

export function initInstallPrompt() {
    let deferredPrompt = null;

    function showBanner() {
        if (document.querySelector('.pwa-install-banner')) return;

        const banner = document.createElement('div');
        banner.className = 'pwa-install-banner';
        banner.innerHTML = `
            <div class="pwa-install-title">${t('Install app')}</div>
            <div class="pwa-install-text">${t('Install Monochrome on this device for a fullscreen, app-like experience.')}</div>
            <div class="pwa-install-actions">
                <button class="btn-secondary" data-action="dismiss">${t('Not now')}</button>
                <button class="btn-secondary" data-action="install">${t('Install')}</button>
            </div>`;

        banner.addEventListener('click', async (e) => {
            const action = e.target.closest('button')?.dataset.action;
            if (action === 'install' && deferredPrompt) {
                banner.remove();
                deferredPrompt.prompt();
                try {
                    await deferredPrompt.userChoice;
                } catch {
                    // user closed the native prompt
                }
                deferredPrompt = null;
            } else if (action === 'dismiss') {
                banner.remove();
                try {
                    localStorage.setItem(DISMISSED_KEY, String(Date.now()));
                } catch {
                    // ignore
                }
            }
        });

        document.body.appendChild(banner);
    }

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;

        // Already running as an installed app
        if (window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator?.standalone === true) {
            return;
        }
        try {
            if (localStorage.getItem(DISMISSED_KEY)) return;
        } catch {
            // ignore
        }
        showBanner();
    });

    window.addEventListener('appinstalled', () => {
        document.querySelector('.pwa-install-banner')?.remove();
        deferredPrompt = null;
    });
}
