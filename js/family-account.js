// js/family-account.js
//
// Family profiles: one Jellyfin account, one Monochrome instance, multiple
// avatars. Profiles live server-side as hidden marker playlists inside the
// single Jellyfin account, so they're shared across every family device.
// Switching profiles never asks for a password — it just changes which
// profile's playlists the app shows. Accessed from the avatar button in the
// top-right corner of the header.
//
// Resilience: the profile list is cached locally so the page still renders
// when the server is unreachable, and a deleted marker playlist for the
// active profile is automatically recreated from the cache.
import { MusicAPI } from './music-api.js';
import { showNotification } from './downloads.js';
import { navigate } from './router.js';
import { escapeHtml } from './utils.js';
import { t } from './i18n.js';

let initialized = false;

const AVATAR_COLORS = ['#e76f51', '#2a9d8f', '#e9c46a', '#9b5de5', '#00b4d8', '#f15bb5', '#80b918', '#ff70a6'];
const PROFILE_CACHE_KEY = 'monochrome-profiles-cache';
const AVATAR_KEY_PREFIX = 'monochrome-avatar-';

function jellyfin() {
    return MusicAPI.instance.jellyfinAPI;
}

function avatarColor(name) {
    let hash = 0;
    for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// --- custom avatars (stored locally as small data URLs) ---------------------

function getCustomAvatar(name) {
    try {
        return localStorage.getItem(AVATAR_KEY_PREFIX + name) || '';
    } catch {
        return '';
    }
}

function setCustomAvatar(name, dataUrl) {
    try {
        if (dataUrl) localStorage.setItem(AVATAR_KEY_PREFIX + name, dataUrl);
        else localStorage.removeItem(AVATAR_KEY_PREFIX + name);
    } catch {
        // storage full or unavailable
    }
}

// Center-crop and downscale to a small square so the data URL stays tiny
function resizeImage(file, size = 128) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            const min = Math.min(img.width, img.height);
            ctx.drawImage(img, (img.width - min) / 2, (img.height - min) / 2, min, min, 0, 0, size, size);
            resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('Could not read image file'));
        };
        img.src = objectUrl;
    });
}

// --- local profile cache (resilience against deleted marker playlists) ------

function readProfileCache() {
    try {
        const raw = localStorage.getItem(PROFILE_CACHE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function writeProfileCache(profiles) {
    try {
        localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profiles.map((p) => ({ name: p.name }))));
    } catch {
        // ignore
    }
}

// --- rendering ---------------------------------------------------------------

export function updateHeaderAvatar() {
    const icon = document.getElementById('header-account-icon');
    const btn = document.getElementById('header-account-btn');
    if (!icon || !btn) return;

    const profile = jellyfin().getActiveProfile();
    if (profile) {
        const avatar = getCustomAvatar(profile);
        if (avatar) {
            icon.innerHTML = `<img src="${avatar}" alt="" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%" />`;
        } else {
            icon.innerHTML = `
                <span class="family-profile-avatar" style="width: 100%; height: 100%; font-size: 1rem; background: ${avatarColor(profile)}; opacity: 1">${escapeHtml(profile[0].toUpperCase())}</span>`;
        }
        btn.title = `${t('Current profile')}: ${profile}`;
    } else {
        btn.title = t('Choose a profile');
    }
}

function profileCardHTML(profile, isCurrent) {
    const initial = (profile.name[0] || '?').toUpperCase();
    const avatar = getCustomAvatar(profile.name);
    const avatarStyle = avatar
        ? `background-image: url('${avatar}')`
        : `background: ${avatarColor(profile.name)}`;
    const title = isCurrent ? t('Current profile') : `${t('Switch to')} ${escapeHtml(profile.name)}`;

    return `
        <button
            class="family-profile-card${isCurrent ? ' current' : ''}"
            data-profile-name="${escapeHtml(profile.name)}"
            title="${title}"
        >
            <span class="family-profile-avatar" style="${avatarStyle}">${avatar ? '' : escapeHtml(initial)}</span>
            <span class="family-profile-name">${escapeHtml(profile.name)}${isCurrent ? ' ✓' : ''}</span>
        </button>`;
}

function createCardHTML() {
    return `
        <button class="family-profile-card" data-create-profile="true" title="${t('Create a new profile')}">
            <span class="family-profile-avatar create">+</span>
            <span class="family-profile-name muted">${t('New profile')}</span>
        </button>`;
}

function showError(message) {
    const error = document.getElementById('family-error');
    if (error) {
        error.textContent = message;
        error.style.display = message ? '' : 'none';
    }
}

function updateAvatarActions() {
    const actions = document.getElementById('family-avatar-actions');
    const removeBtn = document.getElementById('family-avatar-remove');
    if (!actions) return;

    const current = jellyfin().getActiveProfile();
    actions.style.display = current ? '' : 'none';
    if (removeBtn) removeBtn.style.display = current && getCustomAvatar(current) ? '' : 'none';
}

async function renderProfiles() {
    const grid = document.getElementById('family-profiles-grid');
    if (!grid) return;
    showError('');

    grid.innerHTML = `<div style="color: var(--muted-foreground); padding: 1rem 0">${t('Loading profiles...')}</div>`;

    const api = jellyfin();
    const current = api.getActiveProfile();

    try {
        let profiles = await api.listProfiles();

        // The marker playlist for the active profile was deleted server-side:
        // recreate it so the profile (and its playlist prefix) keeps working.
        if (current && !profiles.some((p) => p.name === current)) {
            try {
                await api.createProfile(current);
                profiles = await api.listProfiles();
            } catch {
                // recreation failed — keep going with what the server returned
            }
        }

        writeProfileCache(profiles);
        grid.innerHTML = profiles.map((p) => profileCardHTML(p, p.name === current)).join('') + createCardHTML();
    } catch (error) {
        // Server unreachable: fall back to the cached list so the family can
        // still switch profiles offline.
        const cached = readProfileCache();
        if (cached.length) {
            grid.innerHTML = cached.map((p) => profileCardHTML(p, p.name === current)).join('');
        } else {
            grid.innerHTML = '';
        }
        showError(`${t('Could not load profiles from the family server:')} ${error.message}`);
    }

    updateAvatarActions();
}

async function createProfile() {
    const name = window.prompt(t('Name for the new profile:'));
    if (!name || !name.trim()) return;
    const cleaned = name.trim();

    try {
        await jellyfin().createProfile(cleaned);
        showNotification(`${t('Profile created.')} (${cleaned})`);
        await renderProfiles();
    } catch (error) {
        showError(`${t('Could not create profile:')} ${error.message}`);
    }
}

function switchToProfile(name) {
    jellyfin().setActiveProfile(name);
    showNotification(`${t('Switched to')} ${name}`);
    updateHeaderAvatar();
    // Reload so library/playlists reflect the new profile everywhere
    window.location.href = '/';
}

function pickAvatar() {
    const current = jellyfin().getActiveProfile();
    if (!current) return;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
            const dataUrl = await resizeImage(file);
            setCustomAvatar(current, dataUrl);
            showNotification(t('Avatar updated.'));
            updateHeaderAvatar();
            await renderProfiles();
        } catch {
            showNotification(t('Could not read the image.'));
        }
    });
    input.click();
}

function removeAvatar() {
    const current = jellyfin().getActiveProfile();
    if (!current) return;
    setCustomAvatar(current, '');
    updateHeaderAvatar();
    void renderProfiles();
}

function bindEvents() {
    if (initialized) return;
    initialized = true;

    document.getElementById('family-profiles-grid')?.addEventListener('click', (e) => {
        const card = e.target.closest('.family-profile-card');
        if (!card) return;

        if (card.dataset.createProfile) {
            void createProfile();
            return;
        }

        const name = card.dataset.profileName;
        if (name && name !== jellyfin().getActiveProfile()) {
            switchToProfile(name);
        }
    });

    document.getElementById('family-avatar-upload')?.addEventListener('click', pickAvatar);
    document.getElementById('family-avatar-remove')?.addEventListener('click', removeAvatar);

    // Adapter fires this when the Jellyfin connection stops working
    window.addEventListener('jellyfin:auth-required', () => {
        navigate('/family');
    });

    updateHeaderAvatar();
}

export async function renderFamilyPage(ui) {
    await ui.showPage('family');
    bindEvents();
    await renderProfiles();
}

export function initFamilyAccount() {
    bindEvents();
}
