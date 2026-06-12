import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import authGatePlugin from './vite-plugin-auth-gate.js';
import jellyfinAuthPlugin from './vite-plugin-jellyfin-auth.js';
import ytSearchPlugin from './vite-plugin-yt-search.js';
import previewPlugin from './vite-plugin-preview.js';
import blobAssetPlugin from './vite-plugin-blob.js';
import svgUse from './vite-plugin-svg-use.js';
import uploadPlugin from './vite-plugin-upload.js';
import { playwright } from '@vitest/browser-playwright';
import { execSync } from 'child_process';

function proxyAudioPlugin() {
    return {
        name: 'proxy-audio-dev',
        configureServer(server) {
            // No longer needed: local proxy-audio middleware replaced by remote proxy
        },
    };
}

function getGitCommitHash() {
    try {
        return execSync('git rev-parse --short HEAD').toString().trim();
    } catch {
        return 'unknown';
    }
}

export default defineConfig((_options) => {
    const commitHash = getGitCommitHash();
    const env = loadEnv(_options.mode, process.cwd(), '');

    // Same-origin proxy to the Jellyfin server so streaming and the Web Audio
    // visualizer work without CORS or mixed-content issues.
    const jellyfinProxy = {
        '/jellyfin': {
            target: env.JELLYFIN_TARGET || 'http://localhost:8096',
            changeOrigin: true,
            rewrite: (p: string) => p.replace(/^\/jellyfin/, ''),
        },
        // MeTube (YouTube download manager) — direct container port, bypasses umbrel auth proxy
        '/metube': {
            target: env.METUBE_TARGET || 'http://localhost:3701',
            changeOrigin: true,
            rewrite: (p: string) => p.replace(/^\/metube/, ''),
        },
    };

    return {
        test: {
            // https://vitest.dev/guide/browser/
            browser: {
                enabled: true,
                provider: playwright(),
                headless: !!process.env.HEADLESS,
                instances: [{ browser: 'chromium' }],
            },
        },
        base: './',
        define: {
            __COMMIT_HASH__: JSON.stringify(commitHash),
            __VITEST__: !!process.env.VITEST,
        },
        worker: {
            format: 'es',
        },
        resolve: {
            alias: {
                '!lucide': '/node_modules/lucide-static/icons',
                '!simpleicons': '/node_modules/simple-icons/icons',
                '!': '/node_modules',

                events: '/node_modules/events/events.js',
                pocketbase: '/node_modules/pocketbase/dist/pocketbase.es.js',
                stream: path.resolve(__dirname, 'stream-stub.js'), // Stub for stream module
            },
        },
        optimizeDeps: {
            exclude: ['pocketbase', '@ffmpeg/ffmpeg', '@ffmpeg/util'],
        },
        server: {
            host: true,
            allowedHosts: true,
            proxy: jellyfinProxy,
            fs: {
                allow: ['.', 'node_modules'],
            },
        },
        preview: {
            host: true,
            allowedHosts: true,
            proxy: jellyfinProxy,
        },
        build: {
            outDir: 'dist',
            emptyOutDir: true,
            sourcemap: false,
            minify: 'esbuild',
            reportCompressedSize: false,
            rollupOptions: {
                treeshake: true,
            },
        },
        plugins: [
            proxyAudioPlugin(),
            jellyfinAuthPlugin(),
            ytSearchPlugin(),
            previewPlugin(env.PREVIEW_DIR || 'E:/umbrel/home/Music/.preview-tmp'),
            authGatePlugin(),
            uploadPlugin(),
            blobAssetPlugin(),
            svgUse(),
            VitePWA({
                registerType: 'prompt',
                workbox: {
                    globPatterns: ['**/*.{js,css,html,ico,png,svg,json}'],
                    cleanupOutdatedCaches: true,
                    maximumFileSizeToCacheInBytes: 3 * 1024 * 1024, // 3 MiB limit
                    // Define runtime caching strategies
                    runtimeCaching: [
                        {
                            urlPattern: ({ request }) => request.destination === 'image',
                            handler: 'CacheFirst',
                            options: {
                                cacheName: 'images',
                                expiration: {
                                    maxEntries: 100,
                                    maxAgeSeconds: 60 * 24 * 60 * 60, // 60 Days
                                },
                            },
                        },
                        {
                            // Never cache proxied streams: Jellyfin stream URLs embed a
                            // session token and MeTube/preview streams are transient —
                            // a cached copy causes stale/silent playback failures.
                            urlPattern: ({ url, request }) =>
                                (request.destination === 'audio' || request.destination === 'video') &&
                                !url.pathname.startsWith('/jellyfin/') &&
                                !url.pathname.startsWith('/metube/') &&
                                !url.pathname.startsWith('/api/'),
                            handler: 'CacheFirst',
                            options: {
                                cacheName: 'media',
                                expiration: {
                                    maxEntries: 50,
                                    maxAgeSeconds: 60 * 24 * 60 * 60, // 60 Days
                                },
                                rangeRequests: true, // Support scrubbing
                            },
                        },
                    ],
                },
                includeAssets: ['discord.html'],
                manifest: false, // Use existing public/manifest.json
            }),
        ],
    };
});
