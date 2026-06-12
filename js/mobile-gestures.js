// js/mobile-gestures.js
//
// Touch gestures for phones:
//   - Player bar: swipe up → fullscreen now-playing view,
//     swipe left/right → next/previous track
//   - Home & Library: pull-to-refresh (clears the Jellyfin response cache and
//     re-runs the router so the page re-renders with fresh data)
import { MusicAPI } from './music-api.js';

const SWIPE_MIN_DISTANCE = 50;
const SWIPE_MAX_CROSS = 60;
const SWIPE_MAX_TIME = 600;

function isTouchDevice() {
    return window.matchMedia?.('(hover: none)')?.matches || 'ontouchstart' in window;
}

export function initPlayerBarGestures() {
    const bar = document.querySelector('.now-playing-bar');
    if (!bar || !isTouchDevice()) return;

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let tracking = false;

    bar.addEventListener(
        'touchstart',
        (e) => {
            // Don't hijack sliders or buttons
            if (e.target.closest('input, button, .progress-bar, .volume-bar')) {
                tracking = false;
                return;
            }
            const touch = e.touches[0];
            startX = touch.clientX;
            startY = touch.clientY;
            startTime = Date.now();
            tracking = true;
        },
        { passive: true }
    );

    bar.addEventListener(
        'touchend',
        (e) => {
            if (!tracking) return;
            tracking = false;
            if (Date.now() - startTime > SWIPE_MAX_TIME) return;

            const touch = e.changedTouches[0];
            const dx = touch.clientX - startX;
            const dy = touch.clientY - startY;

            if (-dy >= SWIPE_MIN_DISTANCE && Math.abs(dx) <= SWIPE_MAX_CROSS) {
                // Swipe up → open the fullscreen now-playing view
                document.querySelector('.now-playing-bar .cover')?.click();
                return;
            }

            if (Math.abs(dx) >= SWIPE_MIN_DISTANCE && Math.abs(dy) <= SWIPE_MAX_CROSS) {
                if (dx < 0) document.getElementById('next-btn')?.click();
                else document.getElementById('prev-btn')?.click();
            }
        },
        { passive: true }
    );
}

const REFRESH_ICON = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
        <path d="M21 3v5h-5" />
        <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
        <path d="M8 16H3v5" />
    </svg>`;

export function initPullToRefresh() {
    if (!isTouchDevice()) return;

    const PULL_THRESHOLD = 70;
    let startY = 0;
    let pulling = false;
    let refreshing = false;
    let indicator = null;

    function pageAllowsRefresh() {
        const path = window.location.pathname.replace(/\/+$/, '') || '/';
        return path === '/' || path === '/home' || path === '/library' || path === '/index.html';
    }

    function getIndicator() {
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.className = 'pull-refresh-indicator';
            indicator.innerHTML = REFRESH_ICON;
            document.body.appendChild(indicator);
        }
        return indicator;
    }

    async function refresh() {
        refreshing = true;
        const el = getIndicator();
        el.classList.add('refreshing');
        el.style.transform = 'translate(-50%, 16px)';
        try {
            await MusicAPI.instance.jellyfinAPI.clearCache();
        } catch {
            // API not initialized yet
        }
        // Re-run the router for the current path so the page re-renders
        window.dispatchEvent(new PopStateEvent('popstate'));
        setTimeout(() => {
            el.classList.remove('refreshing');
            el.style.transform = '';
            refreshing = false;
        }, 900);
    }

    document.addEventListener(
        'touchstart',
        (e) => {
            if (refreshing || !pageAllowsRefresh()) return;
            if (window.scrollY > 0) return;
            // Ignore pulls that start on the player bar or overlays
            if (e.target.closest('.now-playing-bar, #fullscreen-cover-overlay, .bottom-nav, .sidebar')) return;
            startY = e.touches[0].clientY;
            pulling = true;
        },
        { passive: true }
    );

    document.addEventListener(
        'touchmove',
        (e) => {
            if (!pulling || refreshing) return;
            const dy = e.touches[0].clientY - startY;
            if (dy <= 0 || window.scrollY > 0) {
                getIndicator().style.transform = '';
                return;
            }
            const offset = Math.min(dy * 0.4 - 60, 24);
            getIndicator().style.transform = `translate(-50%, ${offset}px)`;
        },
        { passive: true }
    );

    document.addEventListener(
        'touchend',
        (e) => {
            if (!pulling || refreshing) return;
            pulling = false;
            const dy = e.changedTouches[0].clientY - startY;
            if (dy >= PULL_THRESHOLD / 0.4 && window.scrollY <= 0) {
                void refresh();
            } else if (indicator) {
                indicator.style.transform = '';
            }
        },
        { passive: true }
    );
}
