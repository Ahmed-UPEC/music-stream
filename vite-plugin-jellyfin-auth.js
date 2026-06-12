// Server-side Jellyfin session broker.
//
// Keeps Jellyfin credentials out of the client bundle: JELLYFIN_USER and
// JELLYFIN_PASS live only in the server environment. The browser asks this
// endpoint for a session and only ever receives the access token + user id —
// the password never crosses the wire to the client.
//
//   POST /api/jellyfin/session -> { token, userId }
//                                  501 when no server-side credentials are set
//                                  502 when Jellyfin rejects or is unreachable
//   GET  /api/jellyfin/status  -> { configured, reachable, serverName, version }

const CLIENT_NAME = 'Monochrome';

function jellyfinTarget() {
    return (process.env.JELLYFIN_TARGET || 'http://localhost:8096').replace(/\/+$/, '');
}

function serverCredentials() {
    const username = process.env.JELLYFIN_USER || process.env.VITE_JELLYFIN_USER || '';
    const password = process.env.JELLYFIN_PASS || process.env.VITE_JELLYFIN_PASS || '';
    return username ? { username, password } : null;
}

async function authenticate(credentials) {
    const response = await fetch(`${jellyfinTarget()}/Users/AuthenticateByName`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Emby-Authorization': `MediaBrowser Client="${CLIENT_NAME}", Device="Server", DeviceId="monochrome-server", Version="1.0.0"`,
        },
        body: JSON.stringify({ Username: credentials.username, Pw: credentials.password }),
        signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
        throw new Error(`Jellyfin authentication failed: HTTP ${response.status}`);
    }

    const data = await response.json();
    if (!data.AccessToken || !data.User?.Id) {
        throw new Error('Jellyfin returned no token');
    }
    return { token: data.AccessToken, userId: data.User.Id };
}

async function serverStatus() {
    const configured = Boolean(serverCredentials());
    try {
        const response = await fetch(`${jellyfinTarget()}/System/Info/Public`, {
            signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) {
            return { configured, reachable: false, error: `HTTP ${response.status}` };
        }
        const info = await response.json();
        return {
            configured,
            reachable: true,
            serverName: info.ServerName || '',
            version: info.Version || '',
        };
    } catch (error) {
        return { configured, reachable: false, error: String(error.message || error) };
    }
}

function sendJson(res, status, payload) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(payload));
}

export default function jellyfinAuthPlugin() {
    const handler = async (req, res, next) => {
        const url = (req.url || '').split('?')[0];

        if (url === '/api/jellyfin/session' && req.method === 'POST') {
            const credentials = serverCredentials();
            if (!credentials) {
                sendJson(res, 501, { error: 'No server-side Jellyfin credentials configured' });
                return;
            }
            try {
                sendJson(res, 200, await authenticate(credentials));
            } catch (error) {
                sendJson(res, 502, { error: String(error.message || error) });
            }
            return;
        }

        if (url === '/api/jellyfin/status') {
            sendJson(res, 200, await serverStatus());
            return;
        }

        next();
    };

    return {
        name: 'jellyfin-auth',
        configureServer(server) {
            server.middlewares.use(handler);
        },
        configurePreviewServer(server) {
            server.middlewares.use(handler);
        },
    };
}
