// Temp-file preview endpoints for the Download page.
//
// MeTube downloads preview tracks into a hidden subfolder of the music
// library (PREVIEW_DIR, default <Music>/.preview-tmp). These endpoints let the
// app list, stream and clear those temp files. A `.ignore` file keeps Jellyfin
// from indexing the folder.
//
//   GET  /api/preview/list        -> { files: [{ name, size, mtime }] } (newest first)
//   GET  /api/preview/stream?f=x  -> audio stream (Range supported)
//   POST /api/preview/clear       -> deletes all temp preview files
import fs from 'fs';
import path from 'path';
import https from 'https';
import { execFile } from 'child_process';

const MIME_TYPES = {
    '.flac': 'audio/flac',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.opus': 'audio/ogg',
    '.ogg': 'audio/ogg',
    '.wav': 'audio/wav',
    '.webm': 'audio/webm',
};

// --- instant preview streaming ---------------------------------------------
// GET /api/preview/play?id=<videoId> resolves the direct audio stream URL via
// yt-dlp (inside the MeTube container, which already has working YouTube
// access) and proxies it to the browser with Range support. Nothing is saved
// to disk — playback starts as soon as YouTube starts serving bytes.

const STREAM_URL_TTL = 3 * 60 * 60 * 1000; // googlevideo links live ~6h; refresh after 3h
const streamUrlCache = new Map(); // videoId -> { url, expires }

function resolveAudioUrl(videoId) {
    const cached = streamUrlCache.get(videoId);
    if (cached && cached.expires > Date.now()) return Promise.resolve(cached.url);

    return new Promise((resolve, reject) => {
        execFile(
            'docker',
            [
                'exec',
                process.env.METUBE_CONTAINER || 'metube_metube_1',
                'yt-dlp',
                '--no-check-certificates',
                '-f',
                'bestaudio[ext=m4a]/bestaudio',
                '-g',
                `https://www.youtube.com/watch?v=${videoId}`,
            ],
            { timeout: 45000 },
            (error, stdout) => {
                const url = (stdout || '').trim().split('\n')[0];
                if (error || !url.startsWith('http')) {
                    reject(new Error(error ? `yt-dlp failed: ${error.message}` : 'No stream URL resolved'));
                    return;
                }
                streamUrlCache.set(videoId, { url, expires: Date.now() + STREAM_URL_TTL });
                resolve(url);
            }
        );
    });
}

// Background warm-up pool: after every search the app sends the result video
// ids here so their stream URLs are resolved ahead of time. Clicking Listen
// then hits the cache and playback starts almost instantly.
const WARM_CONCURRENCY = 2;
const warmQueue = [];
const warmPending = new Set();
let warmActive = 0;

function pumpWarmQueue() {
    while (warmActive < WARM_CONCURRENCY && warmQueue.length) {
        const videoId = warmQueue.shift();
        warmActive += 1;
        resolveAudioUrl(videoId)
            .catch(() => {})
            .finally(() => {
                warmPending.delete(videoId);
                warmActive -= 1;
                pumpWarmQueue();
            });
    }
}

function queueWarmup(videoIds) {
    let queued = 0;
    for (const videoId of videoIds) {
        const cached = streamUrlCache.get(videoId);
        if (cached && cached.expires > Date.now()) continue;
        if (warmPending.has(videoId)) continue;
        warmPending.add(videoId);
        warmQueue.push(videoId);
        queued += 1;
    }
    pumpWarmQueue();
    return queued;
}

function proxyStream(streamUrl, req, res, redirectsLeft = 5) {
    const headers = {};
    if (req.headers.range) headers.Range = req.headers.range;

    const upstream = https.get(streamUrl, { headers, rejectUnauthorized: false }, (upstreamRes) => {
        const status = upstreamRes.statusCode || 200;

        // googlevideo edges often redirect to a sibling host — follow server-side
        if ([301, 302, 303, 307, 308].includes(status) && upstreamRes.headers.location && redirectsLeft > 0) {
            upstreamRes.resume();
            proxyStream(new URL(upstreamRes.headers.location, streamUrl).href, req, res, redirectsLeft - 1);
            return;
        }

        const passthrough = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
        res.statusCode = status;
        for (const name of passthrough) {
            if (upstreamRes.headers[name]) res.setHeader(name, upstreamRes.headers[name]);
        }
        upstreamRes.pipe(res);
    });

    upstream.on('error', (error) => {
        if (!res.headersSent) {
            res.statusCode = 502;
            res.end(`Upstream error: ${error.message}`);
        } else {
            res.destroy();
        }
    });
    res.on('close', () => upstream.destroy());
}

export default function previewPlugin(previewDir) {
    function ensureDir() {
        fs.mkdirSync(previewDir, { recursive: true });
        const ignoreFile = path.join(previewDir, '.ignore');
        if (!fs.existsSync(ignoreFile)) fs.writeFileSync(ignoreFile, '');
    }

    function listFiles() {
        ensureDir();
        return fs
            .readdirSync(previewDir)
            .filter((name) => MIME_TYPES[path.extname(name).toLowerCase()])
            .map((name) => {
                const stats = fs.statSync(path.join(previewDir, name));
                return { name, size: stats.size, mtime: stats.mtimeMs };
            })
            .sort((a, b) => b.mtime - a.mtime);
    }

    const handler = (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/preview/')) return next();

        const url = new URL(req.url, 'http://localhost');

        try {
            if (url.pathname === '/api/preview/play') {
                const videoId = url.searchParams.get('id') || '';
                if (!/^[\w-]{6,16}$/.test(videoId)) {
                    res.statusCode = 400;
                    res.end('Invalid video id');
                    return;
                }
                resolveAudioUrl(videoId)
                    .then((streamUrl) => proxyStream(streamUrl, req, res))
                    .catch((error) => {
                        res.statusCode = 502;
                        res.end(`Could not resolve stream: ${error.message}`);
                    });
                return;
            }

            if (url.pathname === '/api/preview/prefetch') {
                const ids = (url.searchParams.get('ids') || '')
                    .split(',')
                    .map((s) => s.trim())
                    .filter((s) => /^[\w-]{6,16}$/.test(s))
                    .slice(0, 20);
                const queued = queueWarmup(ids);
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ queued, cached: ids.length - queued }));
                return;
            }

            if (url.pathname === '/api/preview/list') {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ files: listFiles() }));
                return;
            }

            if (url.pathname === '/api/preview/clear' && req.method === 'POST') {
                ensureDir();
                for (const file of fs.readdirSync(previewDir)) {
                    if (file === '.ignore') continue;
                    fs.rmSync(path.join(previewDir, file), { force: true });
                }
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ cleared: true }));
                return;
            }

            if (url.pathname === '/api/preview/stream') {
                // basename() blocks path traversal
                const name = path.basename(url.searchParams.get('f') || '');
                const filePath = path.join(previewDir, name);
                const mime = MIME_TYPES[path.extname(name).toLowerCase()];

                if (!name || !mime || !fs.existsSync(filePath)) {
                    res.statusCode = 404;
                    res.end('Not found');
                    return;
                }

                const { size } = fs.statSync(filePath);
                const range = req.headers.range;

                if (range) {
                    const match = range.match(/bytes=(\d*)-(\d*)/);
                    const start = match?.[1] ? parseInt(match[1], 10) : 0;
                    const end = match?.[2] ? parseInt(match[2], 10) : size - 1;
                    res.statusCode = 206;
                    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
                    res.setHeader('Accept-Ranges', 'bytes');
                    res.setHeader('Content-Length', end - start + 1);
                    res.setHeader('Content-Type', mime);
                    fs.createReadStream(filePath, { start, end }).pipe(res);
                } else {
                    res.setHeader('Content-Length', size);
                    res.setHeader('Content-Type', mime);
                    res.setHeader('Accept-Ranges', 'bytes');
                    fs.createReadStream(filePath).pipe(res);
                }
                return;
            }

            next();
        } catch (error) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: String(error.message || error) }));
        }
    };

    return {
        name: 'preview-files',
        configureServer(server) {
            server.middlewares.use(handler);
        },
        configurePreviewServer(server) {
            server.middlewares.use(handler);
        },
    };
}
