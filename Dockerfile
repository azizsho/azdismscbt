# Self-contained image: Node 22 + ffmpeg + yt-dlp.
# Build: docker compose build
# Run:   docker compose up -d
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    DATA_DIR=/app/data

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Official standalone Linux build. It bundles the EJS scripts and can use the
# Node runtime already in this image.
RUN curl -fsSL --retry 3 \
      https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
      -o /usr/local/bin/yt-dlp \
    && chmod 0755 /usr/local/bin/yt-dlp \
    && /usr/local/bin/yt-dlp --version

WORKDIR /app

COPY package.json package-lock.json ./
# ffmpeg-static's postinstall is unnecessary here; the image uses apt ffmpeg.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

COPY src ./src
COPY scripts ./scripts
COPY .env.example ./

RUN mkdir -p /app/data/cache /app/data/tmp /app/data/yt-dlp-cache \
    && chown -R node:node /app

USER node

VOLUME ["/app/data"]

CMD ["node", "src/index.js"]
