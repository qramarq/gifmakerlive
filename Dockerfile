FROM rust:1.99-slim-bookworm AS core
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN cargo build --locked --release -p gifmaker-core

FROM python:3.13-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt ./
COPY bindings/python ./bindings/python
RUN pip install --no-cache-dir -r requirements.txt ./bindings/python
COPY --from=core /src/target/release/libgifmaker_core.so /app/libgifmaker_core.so
ENV GIFMAKER_CORE_LIBRARY=/app/libgifmaker_core.so
COPY app.py ./
COPY web ./web
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000}"]

