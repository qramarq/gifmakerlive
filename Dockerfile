FROM rust:1.99-slim-bookworm AS core
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN cargo build --locked --release -p gifmaker-core

FROM node:24-bookworm-slim AS motion
WORKDIR /motion
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM python:3.13-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg chromium && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=motion /usr/local/bin/node /usr/local/bin/node
COPY --from=motion /motion/node_modules ./node_modules
COPY requirements.txt ./
COPY bindings/python ./bindings/python
RUN pip install --no-cache-dir -r requirements.txt ./bindings/python
COPY --from=core /src/target/release/libgifmaker_core.so /app/libgifmaker_core.so
ENV GIFMAKER_CORE_LIBRARY=/app/libgifmaker_core.so
ENV HYPERFRAMES_BROWSER_PATH=/usr/bin/chromium DO_NOT_TRACK=1 HYPERFRAMES_NO_AUTO_INSTALL=1
COPY app.py image_motion.py video_edits.py ./
COPY motion ./motion
COPY web ./web
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000}"]
