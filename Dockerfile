# ---------- build stage ----------
FROM node:22-alpine AS build

# Avast SSL interception breaks HTTPS on Alpine repos — use HTTP to bypass
RUN sed -i 's/https:/http:/g' /etc/apk/repositories \
    && apk add --no-cache git

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
# --ignore-scripts skips native module postinstall (sharp etc.) — not needed for vite build.
# strict-ssl is disabled only for this install command (Avast workaround), not persisted.
RUN npm_config_strict_ssl=false npm ci --ignore-scripts

COPY . .

# Only the (non-secret) Jellyfin URL is baked into the bundle. Credentials are
# NEVER build args anymore: the runtime container authenticates server-side via
# JELLYFIN_USER / JELLYFIN_PASS env vars (see vite-plugin-jellyfin-auth.js).
ARG VITE_JELLYFIN_URL=/jellyfin
ENV VITE_JELLYFIN_URL=$VITE_JELLYFIN_URL

RUN npm run build

# ---------- runtime stage ----------
FROM node:22-alpine

# docker-cli is needed at runtime: /api/preview/play resolves stream URLs by
# exec-ing yt-dlp inside the MeTube container.
RUN sed -i 's/https:/http:/g' /etc/apk/repositories \
    && apk add --no-cache docker-cli

WORKDIR /app

# Minimal runtime deps: vite preview + the server-side plugins only
COPY docker/runtime-package.json ./package.json
RUN npm_config_strict_ssl=false npm install --omit=dev --no-audit --no-fund

COPY --from=build /app/dist ./dist
COPY vite.preview.config.mjs \
     vite-plugin-jellyfin-auth.js \
     vite-plugin-preview.js \
     vite-plugin-yt-search.js \
     vite-plugin-upload.js \
     vite-plugin-auth-gate.js \
     ./

ENV NODE_ENV=production \
    JELLYFIN_TARGET=http://host.docker.internal:8096 \
    METUBE_TARGET=http://host.docker.internal:3701 \
    PREVIEW_DIR=/data/preview-tmp \
    METUBE_CONTAINER=metube_metube_1

VOLUME /data/preview-tmp

EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -qO /dev/null http://127.0.0.1:4173/health || exit 1

CMD ["node_modules/.bin/vite", "preview", "--config", "vite.preview.config.mjs", "--host", "0.0.0.0", "--port", "4173"]
