// Runtime-only Vite config for `vite preview` inside the production container.
// Only imports the server-side plugins, so the runtime image needs just
// vite + formidable + cookie-session instead of the full build toolchain
// (PWA, vitest, playwright, svgo, ...). See Dockerfile runtime stage.
import { defineConfig } from 'vite';
import compression from 'compression';
import authGatePlugin from './vite-plugin-auth-gate.js';
import ytSearchPlugin from './vite-plugin-yt-search.js';
import previewPlugin from './vite-plugin-preview.js';
import uploadPlugin from './vite-plugin-upload.js';
import jellyfinAuthPlugin from './vite-plugin-jellyfin-auth.js';

// gzip for text assets (styles.css alone is ~260 KB uncompressed; audio
// streams are not affected — compression skips non-text content types)
function compressionPlugin() {
    return {
        name: 'gzip-compression',
        configurePreviewServer(server) {
            server.middlewares.use(compression());
        },
    };
}

export default defineConfig(() => {
    // Same-origin proxies (see vite.config.ts for the dev equivalents)
    const proxy = {
        '/jellyfin': {
            target: process.env.JELLYFIN_TARGET || 'http://host.docker.internal:8096',
            changeOrigin: true,
            rewrite: (p) => p.replace(/^\/jellyfin/, ''),
        },
        '/metube': {
            target: process.env.METUBE_TARGET || 'http://host.docker.internal:3701',
            changeOrigin: true,
            rewrite: (p) => p.replace(/^\/metube/, ''),
        },
    };

    return {
        preview: {
            host: true,
            allowedHosts: true,
            proxy,
        },
        plugins: [
            compressionPlugin(),
            jellyfinAuthPlugin(),
            ytSearchPlugin(),
            previewPlugin(process.env.PREVIEW_DIR || '/data/preview-tmp'),
            authGatePlugin(),
            uploadPlugin(),
        ],
    };
});
