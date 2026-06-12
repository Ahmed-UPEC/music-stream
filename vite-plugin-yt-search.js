// Server-side YouTube search endpoint for the Download page.
// GET /api/yt-search?q=<query> -> { results: [{ id, title, channel, duration, views, published, thumbnail, url }] }
//
// YouTube's search page embeds results as JSON (ytInitialData); we fetch and
// parse it server-side because the browser cannot (CORS). No API key needed.
import https from 'https';

// SOCS=CAI skips the EU cookie-consent interstitial that otherwise 302s requests
const YT_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    Cookie: 'SOCS=CAI; CONSENT=YES+cb',
};

function fetchYouTubeHtml(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(
            url,
            {
                // Tolerate TLS-intercepting proxies on the local network
                rejectUnauthorized: false,
                headers: YT_HEADERS,
            },
            (res) => {
                if (res.statusCode !== 200) {
                    res.resume();
                    reject(new Error(`YouTube responded with HTTP ${res.statusCode}`));
                    return;
                }
                let body = '';
                res.on('data', (chunk) => (body += chunk));
                res.on('end', () => resolve(body));
            }
        );
        req.on('error', reject);
        req.setTimeout(15000, () => req.destroy(new Error('YouTube request timed out')));
    });
}

function fetchSearchHtml(query, type = 'videos') {
    // sp=EgIQAQ%3D%3D filters to videos, sp=EgIQAw%3D%3D filters to playlists (albums)
    const filter = type === 'albums' ? 'EgIQAw%253D%253D' : 'EgIQAQ%253D%253D';
    return fetchYouTubeHtml(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=${filter}`);
}

function parseResults(html) {
    const match = html.match(/var ytInitialData = (.*?);<\/script>/s);
    if (!match) return [];

    let data;
    try {
        data = JSON.parse(match[1]);
    } catch {
        return [];
    }

    const sections =
        data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];

    const results = [];
    for (const section of sections) {
        for (const item of section?.itemSectionRenderer?.contents || []) {
            const v = item.videoRenderer;
            if (v?.videoId) {
                const thumbnails = v.thumbnail?.thumbnails || [];
                results.push({
                    id: v.videoId,
                    type: 'video',
                    title: v.title?.runs?.[0]?.text || 'Untitled',
                    channel: v.ownerText?.runs?.[0]?.text || '',
                    duration: v.lengthText?.simpleText || '',
                    views: v.shortViewCountText?.simpleText || '',
                    published: v.publishedTimeText?.simpleText || '',
                    thumbnail: thumbnails[thumbnails.length - 1]?.url || '',
                    url: `https://www.youtube.com/watch?v=${v.videoId}`,
                });
                continue;
            }

            // Playlists (whole albums) use YouTube's newer lockupViewModel
            const lockup = item.lockupViewModel;
            if (lockup?.contentId && lockup.contentType === 'LOCKUP_CONTENT_TYPE_PLAYLIST') {
                const thumbViewModel =
                    lockup.contentImage?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel;
                const sources = thumbViewModel?.image?.sources || [];
                let trackCount = '';
                for (const overlay of thumbViewModel?.overlays || []) {
                    for (const badge of overlay.thumbnailOverlayBadgeViewModel?.thumbnailBadges || []) {
                        const text = badge.thumbnailBadgeViewModel?.text;
                        if (text) trackCount = text;
                    }
                }
                const metadataRows =
                    lockup.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows || [];
                const channel = metadataRows[0]?.metadataParts?.[0]?.text?.content || '';

                results.push({
                    id: lockup.contentId,
                    type: 'album',
                    title: lockup.metadata?.lockupMetadataViewModel?.title?.content || 'Untitled',
                    channel,
                    trackCount,
                    thumbnail: sources[sources.length - 1]?.url || '',
                    url: `https://www.youtube.com/playlist?list=${lockup.contentId}`,
                });
            }
        }
    }
    return results;
}

function fetchPlaylistHtml(playlistId) {
    return fetchYouTubeHtml(`https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`);
}

function parsePlaylistTracks(html) {
    const match = html.match(/var ytInitialData = (.*?);<\/script>/s);
    if (!match) return [];

    let data;
    try {
        data = JSON.parse(match[1]);
    } catch {
        return [];
    }

    const contents =
        data?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer
            ?.contents?.[0]?.itemSectionRenderer?.contents?.[0]?.playlistVideoListRenderer?.contents || [];

    const tracks = [];
    for (const item of contents) {
        const v = item.playlistVideoRenderer;
        if (!v?.videoId) continue;
        const thumbnails = v.thumbnail?.thumbnails || [];
        tracks.push({
            id: v.videoId,
            type: 'video',
            index: v.index?.simpleText || '',
            title: v.title?.runs?.[0]?.text || 'Untitled',
            channel: v.shortBylineText?.runs?.[0]?.text || '',
            duration: v.lengthText?.simpleText || '',
            thumbnail: thumbnails[thumbnails.length - 1]?.url || '',
            url: `https://www.youtube.com/watch?v=${v.videoId}`,
        });
    }
    return tracks;
}

export default function ytSearchPlugin() {
    const handler = async (req, res, next) => {
        if (!req.url) return next();

        // Album (playlist) contents for the Download page album expansion
        if (req.url.startsWith('/api/yt-playlist')) {
            const playlistId = new URL(req.url, 'http://localhost').searchParams.get('id') || '';
            res.setHeader('Content-Type', 'application/json');
            if (!/^[\w-]{10,50}$/.test(playlistId)) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Invalid playlist id' }));
                return;
            }
            try {
                const html = await fetchPlaylistHtml(playlistId);
                res.end(JSON.stringify({ tracks: parsePlaylistTracks(html) }));
            } catch (error) {
                res.statusCode = 502;
                res.end(JSON.stringify({ error: String(error.message || error) }));
            }
            return;
        }

        if (!req.url.startsWith('/api/yt-search')) return next();

        const query = new URL(req.url, 'http://localhost').searchParams.get('q');
        res.setHeader('Content-Type', 'application/json');

        if (!query || !query.trim()) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Missing q parameter' }));
            return;
        }

        try {
            const type = new URL(req.url, 'http://localhost').searchParams.get('type') || 'videos';
            const html = await fetchSearchHtml(query.trim(), type);
            res.end(JSON.stringify({ results: parseResults(html) }));
        } catch (error) {
            res.statusCode = 502;
            res.end(JSON.stringify({ error: String(error.message || error) }));
        }
    };

    return {
        name: 'yt-search',
        configureServer(server) {
            server.middlewares.use(handler);
        },
        configurePreviewServer(server) {
            server.middlewares.use(handler);
        },
    };
}
