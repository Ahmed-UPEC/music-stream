// js/download-page.js
//
// Download page: search YouTube (via the /api/yt-search dev-server endpoint)
// and queue downloads in MeTube (proxied at /metube), which saves FLAC files
// into the family music library that Jellyfin watches.
import { showNotification } from './downloads.js';
import { escapeHtml } from './utils.js';
import { Player } from './player.js';
import { t } from './i18n.js';

let initialized = false;
let pollTimer = null;
const queuedUrls = new Set();

function statusLabel(entry) {
    if (entry.status === 'finished') return t('Done');
    if (entry.status === 'error') return `${t('Error:')} ${entry.msg || 'failed'}`;
    if (entry.status === 'downloading') {
        const percent = typeof entry.percent === 'number' ? `${Math.round(entry.percent)}%` : '...';
        return `${t('Downloading')} ${percent}`;
    }
    return entry.status || t('Queued');
}

async function refreshQueue() {
    const section = document.getElementById('yt-queue-section');
    const container = document.getElementById('yt-queue-container');
    if (!section || !container) return;

    try {
        const response = await fetch('/metube/history');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const history = await response.json();

        // Hide temp preview downloads from the visible queue
        const isPreview = (e) => (e.folder || '') === PREVIEW_FOLDER;
        const queue = (history.queue || []).filter((e) => !isPreview(e));
        const done = (history.done || [])
            .filter((e) => !isPreview(e))
            .slice(-8)
            .reverse();
        const entries = [...queue, ...done];

        if (entries.length === 0) {
            section.style.display = 'none';
            return;
        }

        section.style.display = '';
        container.innerHTML = entries
            .map((entry) => {
                const isActive = entry.status === 'downloading' || entry.status === 'pending';
                const label = statusLabel(entry);
                return `
                <div class="track-item" style="cursor: default">
                    <div class="track-item-info" style="flex: 1; min-width: 0">
                        <div class="track-item-title" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis">
                            ${escapeHtml(entry.title || entry.id || 'Unknown')}
                        </div>
                        <div class="track-item-artist" style="color: ${entry.status === 'error' ? '#ef4444' : 'var(--muted-foreground)'}">
                            ${escapeHtml(label)}
                        </div>
                    </div>
                    ${isActive ? '<div class="loading-spinner" style="width: 18px; height: 18px"></div>' : ''}
                </div>`;
            })
            .join('');

        const hasActive = queue.length > 0;
        if (hasActive && !pollTimer) {
            pollTimer = setInterval(refreshQueue, 3000);
        } else if (!hasActive && pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    } catch (error) {
        console.warn('MeTube history unavailable:', error);
        section.style.display = 'none';
    }
}

function sanitizeFolderName(name) {
    return String(name)
        .replace(/[\\/:*?"<>|]/g, '')
        .trim()
        .slice(0, 120);
}

async function queueDownload(result, button) {
    button.disabled = true;
    button.textContent = 'Queuing...';

    // Whole albums get their own folder in the music library: Music/<Album>.
    // Single tracks downloaded from an album view land in that album's folder too.
    const folder = result.type === 'album' ? sanitizeFolderName(result.title) : result.albumFolder;

    try {
        const response = await fetch('/metube/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url: result.url,
                quality: 'best',
                format: 'any',
                ...(folder ? { folder } : {}),
                auto_start: true,
            }),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.status === 'error') {
            throw new Error(data.msg || `HTTP ${response.status}`);
        }

        queuedUrls.add(result.url);
        button.textContent = 'Queued ✓';
        showNotification(`${t('Queued:')} ${result.title}`);
        void refreshQueue();
    } catch (error) {
        button.disabled = false;
        button.textContent = 'Download';
        showNotification(`${t('Download failed:')} ${error.message}`);
    }
}

function renderResults(results) {
    const container = document.getElementById('yt-results-container');
    if (!container) return;

    if (!results.length) {
        container.innerHTML =
            '<div style="padding: 20px; text-align: center; color: var(--muted-foreground)">No results found.</div>';
        return;
    }

    container.innerHTML = results
        .map((r, index) => {
            const isAlbum = r.type === 'album';
            const subtitle = isAlbum
                ? `${escapeHtml(r.channel)}${r.trackCount ? ` • ${escapeHtml(r.trackCount)}` : ''} • Album — click to see tracks`
                : `${escapeHtml(r.channel)}${r.duration ? ` • ${escapeHtml(r.duration)}` : ''}${r.views ? ` • ${escapeHtml(r.views)} views` : ''}`;
            return `
        <div class="track-item" data-yt-index="${index}" data-yt-album="${isAlbum}" style="cursor: ${isAlbum ? 'pointer' : 'default'}">
            <img
                src="${escapeHtml(r.thumbnail)}"
                alt=""
                loading="lazy"
                style="width: 80px; height: 45px; object-fit: cover; border-radius: 6px; flex-shrink: 0"
            />
            <div class="track-item-info" style="flex: 1; min-width: 0; margin-left: 12px">
                <div class="track-item-title" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis">
                    ${escapeHtml(r.title)}
                </div>
                <div class="track-item-artist" style="color: var(--muted-foreground)">
                    ${subtitle}
                </div>
            </div>
            ${
                isAlbum
                    ? ''
                    : `<button class="btn-secondary yt-preview-btn" data-yt-index="${index}" style="margin-right: 8px">
                Listen
            </button>`
            }
            <button class="btn-secondary yt-download-btn" data-yt-index="${index}" ${queuedUrls.has(r.url) ? 'disabled' : ''}>
                ${queuedUrls.has(r.url) ? 'Queued ✓' : isAlbum ? 'Download Album' : 'Download'}
            </button>
        </div>
        ${isAlbum ? `<div class="yt-album-tracks" data-yt-album-tracks="${index}" style="display: none; margin: 0 0 12px 24px"></div>` : ''}`;
        })
        .join('');

    container.querySelectorAll('.yt-download-btn').forEach((button) => {
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            const result = results[Number(button.dataset.ytIndex)];
            if (result) void queueDownload(result, button);
        });
    });

    container.querySelectorAll('.yt-preview-btn').forEach((button) => {
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            const result = results[Number(button.dataset.ytIndex)];
            if (result) void playPreview(result);
        });
    });

    // Clicking an album row expands its track list
    container.querySelectorAll('[data-yt-album="true"]').forEach((row) => {
        row.addEventListener('click', () => {
            const result = results[Number(row.dataset.ytIndex)];
            if (result) void toggleAlbumTracks(container, Number(row.dataset.ytIndex), result);
        });
    });
}

async function toggleAlbumTracks(container, index, album) {
    const panel = container.querySelector(`[data-yt-album-tracks="${index}"]`);
    if (!panel) return;

    if (panel.style.display !== 'none') {
        panel.style.display = 'none';
        return;
    }

    panel.style.display = '';
    if (panel.dataset.loaded === 'true') return;

    panel.innerHTML =
        '<div style="padding: 12px; color: var(--muted-foreground)">Loading album tracks...</div>';

    try {
        const response = await fetch(`/api/yt-playlist?id=${encodeURIComponent(album.id)}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

        const tracks = (data.tracks || []).map((t) => ({
            ...t,
            // Single tracks downloaded from an album view go into the album's folder
            albumFolder: sanitizeFolderName(album.title),
        }));

        if (!tracks.length) {
            panel.innerHTML =
                '<div style="padding: 12px; color: var(--muted-foreground)">Could not load tracks for this album.</div>';
            return;
        }

        panel.dataset.loaded = 'true';
        panel.innerHTML = tracks
            .map(
                (t, i) => `
            <div class="track-item" style="cursor: default">
                <span style="width: 24px; text-align: right; color: var(--muted-foreground); flex-shrink: 0">${escapeHtml(t.index || String(i + 1))}</span>
                <div class="track-item-info" style="flex: 1; min-width: 0; margin-left: 12px">
                    <div class="track-item-title" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis">
                        ${escapeHtml(t.title)}
                    </div>
                    <div class="track-item-artist" style="color: var(--muted-foreground)">
                        ${escapeHtml(t.channel)}${t.duration ? ` • ${escapeHtml(t.duration)}` : ''}
                    </div>
                </div>
                <button class="btn-secondary yt-album-track-listen" data-track-index="${i}" style="margin-right: 8px">
                    Listen
                </button>
                <button class="btn-secondary yt-album-track-dl" data-track-index="${i}" ${queuedUrls.has(t.url) ? 'disabled' : ''}>
                    ${queuedUrls.has(t.url) ? 'Queued ✓' : 'Download'}
                </button>
            </div>`
            )
            .join('');

        panel.querySelectorAll('.yt-album-track-listen').forEach((button) => {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                const track = tracks[Number(button.dataset.trackIndex)];
                if (track) void playPreview(track);
            });
        });

        panel.querySelectorAll('.yt-album-track-dl').forEach((button) => {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                const track = tracks[Number(button.dataset.trackIndex)];
                if (track) void queueDownload(track, button);
            });
        });

        // Warm the preview cache for the first album tracks
        prefetchStreamUrls(tracks);
    } catch (error) {
        panel.innerHTML = `<div style="padding: 12px; color: #ef4444">Could not load album tracks: ${escapeHtml(error.message)}</div>`;
    }
}

// Previews stream instantly through the app's main player bar: the dev server
// resolves the direct YouTube audio URL (via yt-dlp, warmed in the background
// on every search) and proxies the bytes. Nothing is downloaded to disk and no
// YouTube player is involved.
const PREVIEW_FOLDER = '.preview-tmp'; // legacy temp folder, still filtered from the queue

function durationToSeconds(text) {
    let seconds = 0;
    for (const part of String(text || '').split(':')) {
        seconds = seconds * 60 + (parseInt(part, 10) || 0);
    }
    return seconds;
}

function toPreviewTrack(result) {
    const artist = { id: null, name: result.channel || 'YouTube' };
    return {
        id: `yt-preview-${result.id}`,
        type: 'track',
        title: result.title,
        artist,
        artists: [artist],
        album: { id: null, title: 'YouTube Preview', cover: result.thumbnail || null },
        duration: durationToSeconds(result.duration),
        audioUrl: `/api/preview/play?id=${encodeURIComponent(result.id)}`,
        audioQuality: 'HIGH',
        audioModes: ['STEREO'],
        mediaMetadata: { tags: [] },
        allowStreaming: true,
        streamReady: true,
        isUnavailable: false,
    };
}

// Plays the preview in the main bottom player bar
async function playPreview(result) {
    const player = Player.instance;
    await player.setQueue([toPreviewTrack(result)], 0);
    await player.playTrackFromQueue();
    showNotification(`${t('Previewing:')} ${result.title}`);
}

// Warm the server-side stream URL cache for these results so Listen is instant
function prefetchStreamUrls(results) {
    const ids = results
        .filter((r) => r.type !== 'album')
        .slice(0, 12)
        .map((r) => r.id)
        .filter(Boolean);
    if (!ids.length) return;
    fetch(`/api/preview/prefetch?ids=${ids.join(',')}`).catch(() => {});
}

let searchType = 'videos';
let lastQuery = '';

async function performSearch(query) {
    const container = document.getElementById('yt-results-container');
    if (!container) return;
    container.innerHTML =
        '<div style="padding: 20px; text-align: center; color: var(--muted-foreground)">Searching YouTube...</div>';

    lastQuery = query;
    try {
        const response = await fetch(`/api/yt-search?q=${encodeURIComponent(query)}&type=${searchType}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        renderResults(data.results || []);
        prefetchStreamUrls(data.results || []);
    } catch (error) {
        container.innerHTML = `<div style="padding: 20px; text-align: center; color: #ef4444">Search failed: ${escapeHtml(error.message)}</div>`;
    }
}

function bindEvents() {
    if (initialized) return;
    initialized = true;

    const form = document.getElementById('yt-search-form');
    const input = document.getElementById('yt-search-input');

    form?.addEventListener('submit', (e) => {
        e.preventDefault();
        const query = input?.value?.trim();
        if (query) void performSearch(query);
    });

    // Clear finished/errored entries from the download queue (files are kept)
    document.getElementById('yt-queue-clear-btn')?.addEventListener('click', async () => {
        try {
            const history = await (await fetch('/metube/history')).json();
            // MeTube keys deletions by URL
            const ids = (history.done || []).map((e) => e.url).filter(Boolean);
            if (ids.length) {
                await fetch('/metube/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids, where: 'done' }),
                });
            }
            await refreshQueue();
            showNotification(t('Download queue cleared.'));
        } catch (error) {
            showNotification(`${t('Could not clear queue:')} ${error.message}`);
        }
    });

    // Songs / Albums search mode toggle
    document.getElementById('yt-search-type')?.addEventListener('click', (e) => {
        const tab = e.target.closest('.search-tab');
        if (!tab || tab.dataset.ytType === searchType) return;

        searchType = tab.dataset.ytType;
        document
            .querySelectorAll('#yt-search-type .search-tab')
            .forEach((t) => t.classList.toggle('active', t === tab));
        if (input) input.placeholder = searchType === 'albums' ? 'Search albums on YouTube...' : 'Search YouTube...';

        const query = input?.value?.trim() || lastQuery;
        if (query) void performSearch(query);
    });
}

export async function renderDownloadPage(ui) {
    await ui.showPage('download');
    bindEvents();
    document.getElementById('yt-search-input')?.focus();
    void refreshQueue();
}

export function stopDownloadPagePolling() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}
