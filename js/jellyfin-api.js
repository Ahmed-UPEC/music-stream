// js/jellyfin-api.js
//
// JellyfinAPI - drop-in music provider backed by a Jellyfin server.
// Implements the same surface as LosslessAPI (api.js) but maps every call to
// the Jellyfin REST API and returns TIDAL-shaped objects, so the rest of the
// app (player, UI, downloads) works unchanged.
//
// Configuration (first match wins):
//   localStorage: jellyfin-server-url / jellyfin-username / jellyfin-password
//   Vite env:     VITE_JELLYFIN_URL / VITE_JELLYFIN_USER / VITE_JELLYFIN_PASS
//
// The default VITE_JELLYFIN_URL is a relative '/jellyfin' path that the Vite
// dev/preview server proxies to the real server (see vite.config.ts), which
// keeps all requests same-origin (no CORS issues for the Web Audio visualizer).

const TICKS_PER_SECOND = 10_000_000;
const CLIENT_NAME = 'Monochrome';
// Jellyfin tokens can expire silently — treat stored tokens as stale after this
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 200;

// Stable per-device id so every family device shows up as its own entry in
// Jellyfin's active sessions instead of one shared "monochrome-jellyfin-web".
function deviceId() {
    try {
        let id = localStorage.getItem('monochrome-device-id');
        if (!id) {
            id = `monochrome-web-${Math.random().toString(36).slice(2, 10)}`;
            localStorage.setItem('monochrome-device-id', id);
        }
        return id;
    } catch {
        return 'monochrome-jellyfin-web';
    }
}

const EMPTY_PAGE = () => ({ items: [], limit: 0, offset: 0, totalNumberOfItems: 0 });

const ITEM_FIELDS = [
    'PrimaryImageAspectRatio',
    'ChildCount',
    'PremiereDate',
    'ProductionYear',
    'RunTimeTicks',
    'ArtistItems',
    'AlbumArtists',
    'Overview',
    'Genres',
].join(',');

export class JellyfinAPI {
    // Hidden playlist that registers a profile, e.g. "__profile__Maheen"
    static PROFILE_MARKER = '__profile__';
    // Separator between profile name and playlist title, e.g. "Maheen ▸ Chill"
    static PROFILE_SEP = ' ▸ ';

    constructor(settings) {
        this._settings = settings;
        this.streamCache = new Map();
        this.responseCache = new Map();
        this._online = null;
        this._serverAuthAvailable = null;
    }

    // --- configuration & auth -------------------------------------------------

    getSetting(storageKey, envKey) {
        try {
            const stored = localStorage.getItem(storageKey);
            if (stored) return stored;
        } catch {
            // localStorage unavailable
        }
        return import.meta.env[envKey] || '';
    }

    get serverUrl() {
        return this.getSetting('jellyfin-server-url', 'VITE_JELLYFIN_URL').replace(/\/+$/, '');
    }

    get username() {
        return this.getSetting('jellyfin-username', 'VITE_JELLYFIN_USER');
    }

    get password() {
        return this.getSetting('jellyfin-password', 'VITE_JELLYFIN_PASS');
    }

    isConfigured() {
        // Server-side credentials (the session broker) make a username in the
        // browser optional — serverUrl alone is enough until proven otherwise.
        return Boolean(this.serverUrl && (this.username || this._serverAuthAvailable !== false));
    }

    authHeader() {
        // Device name carries the active profile so Jellyfin's session list
        // distinguishes who is listening on which device.
        const profile = this.getActiveProfile().replace(/"/g, '');
        const device = profile ? `Web (${profile})` : 'Web';
        return `MediaBrowser Client="${CLIENT_NAME}", Device="${device}", DeviceId="${deviceId()}", Version="1.0.0"`;
    }

    // Dispatch a connection status change so the UI can show an indicator
    _setOnline(online) {
        if (this._online === online) return;
        this._online = online;
        try {
            window.dispatchEvent(new CustomEvent('jellyfin:connection-status', { detail: { online } }));
        } catch {
            // non-browser context
        }
    }

    isOnline() {
        return this._online !== false;
    }

    _authRequired() {
        // Let the family-account UI prompt for credentials
        try {
            window.dispatchEvent(new CustomEvent('jellyfin:auth-required'));
        } catch {
            // non-browser context
        }
    }

    // Tokens live in sessionStorage (not localStorage) to shrink the XSS
    // window, with a timestamp so silently-expired tokens get refreshed.
    _storeSession() {
        try {
            sessionStorage.setItem('jellyfin-token', this.token);
            sessionStorage.setItem('jellyfin-user-id', this.userId);
            sessionStorage.setItem('jellyfin-token-time', String(Date.now()));
        } catch {
            // ignore
        }
        try {
            // Older builds kept the token in localStorage — clean it up
            localStorage.removeItem('jellyfin-token');
            localStorage.removeItem('jellyfin-user-id');
        } catch {
            // ignore
        }
    }

    _clearStoredSession() {
        try {
            sessionStorage.removeItem('jellyfin-token');
            sessionStorage.removeItem('jellyfin-user-id');
            sessionStorage.removeItem('jellyfin-token-time');
        } catch {
            // ignore
        }
        try {
            localStorage.removeItem('jellyfin-token');
            localStorage.removeItem('jellyfin-user-id');
        } catch {
            // ignore
        }
    }

    // Ask the server-side broker for a session. Credentials stay in the
    // container environment and never reach the browser.
    async _serverSession() {
        try {
            const response = await fetch('/api/jellyfin/session', { method: 'POST' });
            if (response.status === 501) {
                this._serverAuthAvailable = false;
                return null;
            }
            if (!response.ok) return null;
            const data = await response.json();
            if (!data?.token || !data?.userId) return null;
            this._serverAuthAvailable = true;
            return data;
        } catch {
            return null;
        }
    }

    async authenticate() {
        const session = await this._serverSession();
        if (session) {
            this.token = session.token;
            this.userId = session.userId;
            this._storeSession();
            this._setOnline(true);
            return { token: this.token, userId: this.userId };
        }

        if (!this.username) {
            this._authRequired();
            throw new Error('Jellyfin authentication failed: no credentials available');
        }

        let response;
        try {
            response = await fetch(`${this.serverUrl}/Users/AuthenticateByName`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Emby-Authorization': this.authHeader(),
                },
                body: JSON.stringify({ Username: this.username, Pw: this.password }),
            });
        } catch (error) {
            this._setOnline(false);
            throw error;
        }

        if (!response.ok) {
            this._authRequired();
            throw new Error(`Jellyfin authentication failed: HTTP ${response.status}`);
        }

        const data = await response.json();
        this.token = data.AccessToken;
        this.userId = data.User?.Id;
        this._storeSession();
        this._setOnline(true);

        return { token: this.token, userId: this.userId };
    }

    async ensureAuth() {
        if (!this.token || !this.userId) {
            try {
                this.token = this.token || sessionStorage.getItem('jellyfin-token');
                this.userId = this.userId || sessionStorage.getItem('jellyfin-user-id');
            } catch {
                // ignore
            }
        }

        // Drop tokens older than TOKEN_TTL_MS — Jellyfin can expire them silently
        if (this.token) {
            let storedAt = Date.now();
            try {
                storedAt = Number(sessionStorage.getItem('jellyfin-token-time')) || Date.now();
            } catch {
                // ignore
            }
            if (Date.now() - storedAt > TOKEN_TTL_MS) {
                this.token = null;
                this.userId = null;
                this._clearStoredSession();
            }
        }

        if (!this.token || !this.userId) {
            await this.authenticate();
        }
    }

    async request(path, { retried = false } = {}) {
        await this.ensureAuth();

        const url = `${this.serverUrl}${path}${path.includes('?') ? '&' : '?'}userId=${this.userId}`;
        let response;
        try {
            response = await fetch(url, {
                headers: {
                    'X-Emby-Token': this.token,
                    'X-Emby-Authorization': this.authHeader(),
                },
            });
        } catch (error) {
            this._setOnline(false);
            throw error;
        }

        if (response.status === 401 && !retried) {
            // Stale token: re-authenticate once and retry
            this.token = null;
            this.userId = null;
            this._clearStoredSession();
            await this.authenticate();
            return this.request(path, { retried: true });
        }

        if (!response.ok) {
            if (response.status >= 500) this._setOnline(false);
            throw new Error(`Jellyfin request failed (${path}): HTTP ${response.status}`);
        }

        this._setOnline(true);
        return response.json();
    }

    // TTL + LRU response cache: entries expire after CACHE_TTL_MS and the
    // least-recently-used entry is evicted once CACHE_MAX_ENTRIES is reached.
    _cacheGet(path) {
        const entry = this.responseCache.get(path);
        if (!entry) return null;
        if (Date.now() > entry.expires) {
            this.responseCache.delete(path);
            return null;
        }
        // Re-insert on hit so Map iteration order doubles as LRU order
        this.responseCache.delete(path);
        this.responseCache.set(path, entry);
        return entry;
    }

    _cacheSet(path, data) {
        if (this.responseCache.size >= CACHE_MAX_ENTRIES) {
            const oldest = this.responseCache.keys().next().value;
            this.responseCache.delete(oldest);
        }
        this.responseCache.set(path, { data, expires: Date.now() + CACHE_TTL_MS });
    }

    async cachedRequest(path) {
        const cached = this._cacheGet(path);
        if (cached) return cached.data;
        const data = await this.request(path);
        this._cacheSet(path, data);
        return data;
    }

    async mutate(path, method = 'POST', body = null) {
        await this.ensureAuth();

        const url = `${this.serverUrl}${path}`;
        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'X-Emby-Token': this.token,
                'X-Emby-Authorization': this.authHeader(),
            },
            body: body ? JSON.stringify(body) : undefined,
        });

        if (!response.ok) {
            throw new Error(`Jellyfin ${method} ${path} failed: HTTP ${response.status}`);
        }

        this.responseCache.clear();
        const text = await response.text();
        try {
            return text ? JSON.parse(text) : null;
        } catch {
            return null;
        }
    }

    // --- family profiles ------------------------------------------------------------
    //
    // One Jellyfin account, one Monochrome instance, multiple profiles (avatars).
    // Profiles are stored server-side inside the single Jellyfin account:
    // a hidden marker playlist `__profile__<Name>` registers each profile, and a
    // profile's playlists are stored with a `<Name> ▸ ` title prefix. That keeps
    // everything per-profile AND shared across all family devices, with no
    // passwords and no extra Jellyfin users.

    getCurrentUsername() {
        return this.username;
    }

    getActiveProfile() {
        try {
            return localStorage.getItem('monochrome-profile') || '';
        } catch {
            return '';
        }
    }

    setActiveProfile(name) {
        try {
            if (name) localStorage.setItem('monochrome-profile', name);
            else localStorage.removeItem('monochrome-profile');
        } catch {
            // ignore
        }
        this.responseCache.clear();
    }

    async fetchAllPlaylists() {
        const data = await this.request(`/Items?IncludeItemTypes=Playlist&Recursive=true&Fields=${ITEM_FIELDS}`);
        return data.Items || [];
    }

    async listProfiles() {
        const items = await this.fetchAllPlaylists();
        return items
            .filter((i) => i.Name?.startsWith(JellyfinAPI.PROFILE_MARKER))
            .map((i) => ({ id: i.Id, name: i.Name.slice(JellyfinAPI.PROFILE_MARKER.length) }));
    }

    async createProfile(name) {
        await this.ensureAuth();
        return this.mutate('/Playlists', 'POST', {
            Name: `${JellyfinAPI.PROFILE_MARKER}${name}`,
            UserId: this.userId,
            Ids: [],
            MediaType: 'Audio',
        });
    }

    async login(username, password) {
        try {
            localStorage.setItem('jellyfin-username', username);
            localStorage.setItem('jellyfin-password', password);
        } catch {
            // ignore
        }
        this.token = null;
        this.userId = null;
        this._clearStoredSession();
        this.responseCache.clear();
        this.streamCache.clear();
        return this.authenticate();
    }

    logout() {
        try {
            localStorage.removeItem('jellyfin-username');
            localStorage.removeItem('jellyfin-password');
        } catch {
            // ignore
        }
        this.token = null;
        this.userId = null;
        this._clearStoredSession();
        this.responseCache.clear();
        this.streamCache.clear();
    }

    // --- mapping helpers --------------------------------------------------------

    // Absolute URL so it passes the `startsWith('http')` passthrough in cover helpers
    absoluteUrl(path) {
        if (/^https?:/i.test(this.serverUrl)) return `${this.serverUrl}${path}`;
        return new URL(`${this.serverUrl}${path}`, window.location.origin).href;
    }

    imageUrl(itemId, size = 640) {
        if (!itemId) return null;
        return this.absoluteUrl(`/Items/${itemId}/Images/Primary?maxWidth=${size}&quality=90`);
    }

    ticksToSeconds(ticks) {
        return ticks ? Math.round(ticks / TICKS_PER_SECOND) : 0;
    }

    releaseDateOf(item) {
        if (item.PremiereDate) return item.PremiereDate.split('T')[0];
        if (item.ProductionYear) return `${item.ProductionYear}-01-01`;
        return undefined;
    }

    mapArtistRef(ref) {
        if (!ref) return { id: null, name: 'Unknown Artist', type: 'MAIN' };
        return { id: ref.Id, name: ref.Name, type: 'MAIN', picture: null };
    }

    mapTrack(item) {
        let artists = (item.ArtistItems || []).map((a) => this.mapArtistRef(a));
        if (!artists.length && Array.isArray(item.Artists) && item.Artists.length) {
            // Freshly edited metadata has artist names before Jellyfin links entities
            artists = item.Artists.map((name) => ({ id: null, name, type: 'MAIN', picture: null }));
        }
        const artist = artists[0] || this.mapArtistRef(item.AlbumArtists?.[0]);
        const cover =
            item.AlbumPrimaryImageTag || item.ImageTags?.Primary ? this.imageUrl(item.AlbumId || item.Id) : null;

        return {
            id: item.Id,
            title: item.Name,
            type: 'track',
            duration: this.ticksToSeconds(item.RunTimeTicks),
            trackNumber: item.IndexNumber || 1,
            volumeNumber: item.ParentIndexNumber || 1,
            explicit: false,
            popularity: item.UserData?.PlayCount || 0,
            audioQuality: 'LOSSLESS',
            audioModes: ['STEREO'],
            mediaMetadata: { tags: ['LOSSLESS'] },
            allowStreaming: true,
            streamReady: true,
            isUnavailable: false,
            artist,
            artists: artists.length ? artists : [artist],
            album: {
                id: item.AlbumId || null,
                title: item.Album || '',
                cover,
                releaseDate: this.releaseDateOf(item),
            },
        };
    }

    mapAlbum(item) {
        const artists = (item.AlbumArtists || item.ArtistItems || []).map((a) => this.mapArtistRef(a));
        const artist = artists[0] || { id: null, name: item.AlbumArtist || 'Unknown Artist', type: 'MAIN' };

        return {
            id: item.Id,
            title: item.Name,
            cover: item.ImageTags?.Primary ? this.imageUrl(item.Id) : null,
            type: 'ALBUM',
            duration: this.ticksToSeconds(item.RunTimeTicks),
            numberOfTracks: item.ChildCount || 0,
            numberOfVolumes: 1,
            numberOfVideos: 0,
            releaseDate: this.releaseDateOf(item),
            explicit: false,
            popularity: 0,
            audioQuality: 'LOSSLESS',
            audioModes: ['STEREO'],
            mediaMetadata: { tags: ['LOSSLESS'] },
            allowStreaming: true,
            streamReady: true,
            artist,
            artists: artists.length ? artists : [artist],
        };
    }

    mapArtist(item) {
        return {
            id: item.Id,
            name: item.Name,
            picture: item.ImageTags?.Primary ? this.imageUrl(item.Id) : null,
            type: 'MAIN',
            artistTypes: ['MAIN'],
        };
    }

    mapPlaylist(item) {
        const image = item.ImageTags?.Primary ? this.imageUrl(item.Id) : null;
        return {
            id: item.Id,
            uuid: item.Id,
            title: item.Name,
            description: item.Overview || '',
            numberOfTracks: item.ChildCount || 0,
            duration: this.ticksToSeconds(item.RunTimeTicks),
            image,
            squareImage: image,
        };
    }

    page(items, total) {
        return {
            items,
            limit: items.length,
            offset: 0,
            totalNumberOfItems: total ?? items.length,
        };
    }

    // --- search -----------------------------------------------------------------

    async searchItems(query, includeItemTypes, limit = 30) {
        const params = `searchTerm=${encodeURIComponent(query)}&IncludeItemTypes=${includeItemTypes}&Recursive=true&Limit=${limit}&Fields=${ITEM_FIELDS}`;
        return this.cachedRequest(`/Items?${params}`);
    }

    async search(query, _options = {}) {
        const [tracks, albums, artists, playlists] = await Promise.all([
            this.searchTracks(query).catch(() => EMPTY_PAGE()),
            this.searchAlbums(query).catch(() => EMPTY_PAGE()),
            this.searchArtists(query).catch(() => EMPTY_PAGE()),
            this.searchPlaylists(query).catch(() => EMPTY_PAGE()),
        ]);

        return { tracks, albums, artists, playlists, videos: EMPTY_PAGE() };
    }

    async searchTracks(query, _options = {}) {
        const data = await this.searchItems(query, 'Audio');
        return this.page(
            (data.Items || []).map((i) => this.mapTrack(i)),
            data.TotalRecordCount
        );
    }

    async searchAlbums(query, _options = {}) {
        const data = await this.searchItems(query, 'MusicAlbum');
        return this.page(
            (data.Items || []).map((i) => this.mapAlbum(i)),
            data.TotalRecordCount
        );
    }

    async searchArtists(query, _options = {}) {
        const params = `searchTerm=${encodeURIComponent(query)}&Limit=20&Fields=${ITEM_FIELDS}`;
        const data = await this.cachedRequest(`/Artists?${params}`);
        return this.page(
            (data.Items || []).map((i) => this.mapArtist(i)),
            data.TotalRecordCount
        );
    }

    async searchPlaylists(query, _options = {}) {
        const data = await this.searchItems(query, 'Playlist');
        return this.page(
            (data.Items || []).map((i) => this.mapPlaylist(i)),
            data.TotalRecordCount
        );
    }

    async searchVideos(_query, _options = {}) {
        return EMPTY_PAGE();
    }

    // --- enrichment (parity with LosslessAPI surface used by the UI) -------------

    async enrichArtistsWithPicture(artists, _maxRequests = 10) {
        const missing = (artists || []).filter((a) => a?.id && !a.picture);
        if (missing.length === 0) return artists;

        try {
            const ids = missing
                .slice(0, 50)
                .map((a) => a.id)
                .join(',');
            const data = await this.cachedRequest(`/Items?Ids=${ids}&Fields=${ITEM_FIELDS}`);
            const tagById = new Map((data.Items || []).map((i) => [i.Id, i.ImageTags?.Primary]));
            return artists.map((a) =>
                a?.id && !a.picture && tagById.get(a.id) ? { ...a, picture: this.imageUrl(a.id) } : a
            );
        } catch {
            return artists;
        }
    }

    async enrichTracksWithAlbumCover(tracks, _maxRequests = 20) {
        return tracks;
    }

    async enrichTracksWithAlbumDates(tracks, _maxRequests = 20) {
        return tracks;
    }

    // --- items ------------------------------------------------------------------

    async getItem(id) {
        return this.cachedRequest(`/Items/${id}?Fields=${ITEM_FIELDS}`);
    }

    async getAlbum(id) {
        const [albumItem, tracksData] = await Promise.all([
            this.getItem(id),
            this.cachedRequest(
                `/Items?ParentId=${id}&IncludeItemTypes=Audio&SortBy=ParentIndexNumber,IndexNumber&Fields=${ITEM_FIELDS}`
            ),
        ]);

        const album = this.mapAlbum(albumItem);
        const tracks = (tracksData.Items || []).map((i) => {
            const track = this.mapTrack(i);
            track.album = { ...track.album, id, title: album.title, cover: track.album.cover || album.cover };
            return track;
        });

        album.numberOfTracks = tracks.length || album.numberOfTracks;
        return { album, tracks };
    }

    async getArtist(artistId, _options = {}) {
        const [artistItem, albumsData, tracksData] = await Promise.all([
            this.getItem(artistId),
            this.cachedRequest(
                `/Items?AlbumArtistIds=${artistId}&IncludeItemTypes=MusicAlbum&Recursive=true&SortBy=PremiereDate&SortOrder=Descending&Fields=${ITEM_FIELDS}`
            ),
            this.cachedRequest(
                `/Items?ArtistIds=${artistId}&IncludeItemTypes=Audio&Recursive=true&Limit=15&SortBy=PlayCount&SortOrder=Descending&Fields=${ITEM_FIELDS}`
            ),
        ]);

        const artist = this.mapArtist(artistItem);
        artist.biography = artistItem.Overview || null;

        return {
            ...artist,
            albums: (albumsData.Items || []).map((i) => this.mapAlbum(i)),
            eps: [],
            tracks: (tracksData.Items || []).map((i) => this.mapTrack(i)),
            videos: [],
        };
    }

    async getArtistTopTracks(artistId, options = {}) {
        const limit = options.limit || 15;
        const offset = options.offset || 0;
        const data = await this.cachedRequest(
            `/Items?ArtistIds=${artistId}&IncludeItemTypes=Audio&Recursive=true&Limit=${limit}&StartIndex=${offset}&SortBy=PlayCount&SortOrder=Descending&Fields=${ITEM_FIELDS}`
        );
        const result = this.page(
            (data.Items || []).map((i) => this.mapTrack(i)),
            data.TotalRecordCount
        );
        result.offset = offset;
        return result;
    }

    async getArtistBiography(artistId) {
        try {
            const item = await this.getItem(artistId);
            return item.Overview || null;
        } catch {
            return null;
        }
    }

    async getArtistSocials(_artistName) {
        return null;
    }

    async getSimilarArtists(artistId) {
        try {
            const data = await this.cachedRequest(`/Items/${artistId}/Similar?Limit=10&Fields=${ITEM_FIELDS}`);
            return (data.Items || []).map((i) => this.mapArtist(i));
        } catch {
            return [];
        }
    }

    async getSimilarAlbums(albumId) {
        try {
            const data = await this.cachedRequest(`/Items/${albumId}/Similar?Limit=10&Fields=${ITEM_FIELDS}`);
            return (data.Items || []).map((i) => this.mapAlbum(i));
        } catch {
            return [];
        }
    }

    async getPlaylist(id) {
        const [playlistItem, tracksData] = await Promise.all([
            this.getItem(id),
            this.cachedRequest(`/Playlists/${id}/Items?Fields=${ITEM_FIELDS}`),
        ]);

        const playlist = this.mapPlaylist(playlistItem);
        // Strip the profile prefix from the title for display
        const sepIndex = playlist.title.indexOf(JellyfinAPI.PROFILE_SEP);
        if (sepIndex > 0) {
            playlist.title = playlist.title.slice(sepIndex + JellyfinAPI.PROFILE_SEP.length);
        }
        const tracks = (tracksData.Items || []).map((i) => this.mapTrack(i));
        playlist.numberOfTracks = tracks.length;
        return { playlist, tracks };
    }

    async getMix(_id) {
        throw new Error('Mixes are not supported by the Jellyfin provider');
    }

    // --- server playlist management (per Jellyfin user) ----------------------------

    async getUserPlaylists() {
        const items = await this.fetchAllPlaylists();
        const profile = this.getActiveProfile();
        const prefix = profile ? `${profile}${JellyfinAPI.PROFILE_SEP}` : null;

        return items
            .filter((i) => {
                const name = i.Name || '';
                if (name.startsWith(JellyfinAPI.PROFILE_MARKER)) return false;
                if (prefix) return name.startsWith(prefix);
                // No profile selected: show only shared (unprefixed) playlists
                return !name.includes(JellyfinAPI.PROFILE_SEP);
            })
            .map((i) => {
                const playlist = this.mapPlaylist(i);
                if (prefix) playlist.title = playlist.title.slice(prefix.length);
                return playlist;
            });
    }

    async createPlaylist(name, itemIds = []) {
        await this.ensureAuth();
        const profile = this.getActiveProfile();
        const fullName = profile ? `${profile}${JellyfinAPI.PROFILE_SEP}${name}` : name;
        const result = await this.mutate('/Playlists', 'POST', {
            Name: fullName,
            UserId: this.userId,
            Ids: itemIds,
            MediaType: 'Audio',
        });
        return result?.Id || null;
    }

    async addToPlaylist(playlistId, itemId) {
        await this.ensureAuth();
        return this.mutate(`/Playlists/${playlistId}/Items?Ids=${itemId}&UserId=${this.userId}`, 'POST');
    }

    async removeFromPlaylist(playlistId, itemId) {
        // Jellyfin removes by playlist entry id, not item id — look it up first
        const data = await this.request(`/Playlists/${playlistId}/Items`);
        const entry = (data.Items || []).find((i) => i.Id === itemId);
        const entryId = entry?.PlaylistItemId;
        if (!entryId) return null;
        return this.mutate(`/Playlists/${playlistId}/Items?EntryIds=${entryId}`, 'DELETE');
    }

    async playlistContainsItem(playlistId, itemId) {
        try {
            const data = await this.request(`/Playlists/${playlistId}/Items`);
            return (data.Items || []).some((i) => i.Id === itemId);
        } catch {
            return false;
        }
    }

    async getVideo(_id) {
        throw new Error('Videos are not supported by the Jellyfin provider');
    }

    // --- library browsing (downloaded music) ---------------------------------------

    async getRecentAlbums(limit = 60) {
        const data = await this.request(
            `/Items?IncludeItemTypes=MusicAlbum&Recursive=true&SortBy=DateCreated&SortOrder=Descending&Limit=${limit}&Fields=${ITEM_FIELDS}`
        );
        return (data.Items || []).map((i) => this.mapAlbum(i));
    }

    async getAllArtists(limit = 60) {
        const data = await this.request(`/Artists?Limit=${limit}&SortBy=SortName&Fields=${ITEM_FIELDS}`);
        return (data.Items || []).map((i) => this.mapArtist(i));
    }

    async getRecentTracks(limit = 100) {
        const data = await this.request(
            `/Items?IncludeItemTypes=Audio&Recursive=true&SortBy=DateCreated&SortOrder=Descending&Limit=${limit}&Fields=${ITEM_FIELDS}`
        );
        return (data.Items || []).map((i) => this.mapTrack(i));
    }

    // Assign an artist to a track (e.g. downloads with missing metadata).
    // Jellyfin's update endpoint expects the full item DTO posted back.
    async setTrackArtist(itemId, artistName) {
        const item = await this.request(`/Items/${itemId}`);
        const updated = {
            ...item,
            Artists: [artistName],
            ArtistItems: [{ Name: artistName }],
            AlbumArtists: [{ Name: artistName }],
        };
        const result = await this.mutate(`/Items/${itemId}`, 'POST', updated);
        // Kick a library scan so Jellyfin creates/links the artist entity
        // (user-edited metadata survives scans)
        this.mutate('/Library/Refresh', 'POST').catch(() => {});
        return result;
    }

    // --- recommendations (Jellyfin InstantMix) -----------------------------------

    async getTrackRecommendations(id) {
        try {
            const data = await this.request(`/Items/${id}/InstantMix?Limit=20&Fields=${ITEM_FIELDS}`);
            return (data.Items || []).map((i) => this.mapTrack(i)).filter((t) => t.id !== id);
        } catch {
            return [];
        }
    }

    async getRecommendedTracksForPlaylist(tracks, limit = 20, _options = {}) {
        const seed = tracks?.[tracks.length - 1];
        if (!seed?.id) return [];
        try {
            const data = await this.request(
                `/Items/${seed.id}/InstantMix?Limit=${limit + tracks.length}&Fields=${ITEM_FIELDS}`
            );
            const existing = new Set(tracks.map((t) => String(t.id)));
            return (data.Items || [])
                .map((i) => this.mapTrack(i))
                .filter((t) => !existing.has(String(t.id)))
                .slice(0, limit);
        } catch {
            return [];
        }
    }

    // --- tracks & streaming -------------------------------------------------------

    async getTrackMetadata(id) {
        const item = await this.getItem(id);
        return this.mapTrack(item);
    }

    async getStreamUrl(id, _quality = 'LOSSLESS') {
        const cacheKey = `jf_stream_${id}`;
        if (this.streamCache.has(cacheKey)) return this.streamCache.get(cacheKey);

        await this.ensureAuth();
        const url = this.absoluteUrl(`/Audio/${id}/stream?static=true&api_key=${this.token}`);

        const result = {
            url,
            sourceUrl: url,
            provider: 'jellyfin',
            quality: 'LOSSLESS',
            qualityDisplay: 'FLAC',
            rgInfo: {
                trackReplayGain: 0,
                trackPeakAmplitude: 1,
                albumReplayGain: 0,
                albumPeakAmplitude: 1,
            },
        };

        this.streamCache.set(cacheKey, result);
        return result;
    }

    async getTrack(id, quality = 'LOSSLESS') {
        const [track, streamInfo] = await Promise.all([this.getTrackMetadata(id), this.getStreamUrl(id, quality)]);
        return {
            track,
            info: {
                trackId: id,
                audioQuality: 'LOSSLESS',
                ...streamInfo.rgInfo,
            },
            originalTrackUrl: streamInfo.url,
        };
    }

    async getVideoStreamUrl(_id) {
        throw new Error('Videos are not supported by the Jellyfin provider');
    }

    extractStreamUrlFromManifest(manifest) {
        return typeof manifest === 'string' ? manifest : null;
    }

    async downloadTrack(id, _quality, filename, _options = {}) {
        const { url } = await this.getStreamUrl(id);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);

        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = filename || `${id}.flac`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(objectUrl);
    }

    // --- covers --------------------------------------------------------------------

    getCoverUrl(id, size = '320') {
        if (!id) return `https://picsum.photos/seed/${Math.random()}/${size}`;
        if (
            typeof id === 'string' &&
            (id.startsWith('http') || id.startsWith('blob:') || id.startsWith('data:') || id.startsWith('assets/'))
        ) {
            return id;
        }
        // Fallback for TIDAL-style cover uuids saved in the local library
        const formattedId = String(id).replace(/-/g, '/');
        return `https://resources.tidal.com/images/${formattedId}/${size}x${size}.jpg`;
    }

    getCoverSrcset(_id) {
        return '';
    }

    getArtistPictureUrl(id, size = '320') {
        return this.getCoverUrl(id, size);
    }

    getArtistPictureSrcset(_id) {
        return '';
    }

    getVideoCoverUrl(imageId, _size = '1280') {
        if (!imageId) return null;
        return this.getCoverUrl(imageId);
    }

    // --- cache -----------------------------------------------------------------------

    async clearCache() {
        this.streamCache.clear();
        this.responseCache.clear();
    }

    getCacheStats() {
        return {
            responses: this.responseCache.size,
            streamUrls: this.streamCache.size,
        };
    }
}
