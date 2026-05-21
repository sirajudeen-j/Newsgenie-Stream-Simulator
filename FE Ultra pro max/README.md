# NewsGenie Forensic Proxy + React Frontend

## Overview

A React frontend paired with a Python forensic proxy that embeds device-authentic EXIF metadata into video segments before relaying them to the NewsGenie backend for trust-layer scoring.

## Architecture

```
React FE  →  Forensic Proxy (FastAPI)  →  NewsGenie Backend (WebSocket)
              ├─ FFmpeg re-encode + EXIF injection
              ├─ Fingerprint stripping (bit-exact)
              └─ Local segment storage (captures/, forensic_segments/)
```

## Quick Start

### Prerequisites

- Node.js 18+
- Python 3.10+
- FFmpeg (must be on PATH)

### Frontend

```bash
npm install
npm run dev
```

### Proxy

```bash
pip install fastapi uvicorn httpx websockets
python exif_proxy.py
```

The proxy runs on `http://localhost:8001` with auto-reload enabled.

## Modes

| Mode | Description |
|------|-------------|
| **FILE** | Upload a video file → proxy segments, poisons, and relays each 10s chunk |
| **LIVE** | Camera capture → 5s WebM chunks accumulated into 10s MP4 segments |
| **STAGED** | Pre-uploaded source → proxy cuts 10s segments on demand |

## Key Files

| File | Purpose |
|------|---------|
| `exif_proxy.py` | FastAPI proxy — EXIF injection, WebSocket bridge, segment relay |
| `embed_metadata.py` | Standalone CLI/GUI tool for metadata embedding |
| `metadata.json` | EXIF template (device tags, GPS, creation_time) |
| `src/components/VideoStreaming.jsx` | Main streaming UI — FILE and LIVE modes |
| `src/components/TelemetryPanel.jsx` | Device telemetry controls |

## Timestamp Sync

The backend compares `telemetry_timestamp` (epoch ms) against EXIF `creation_time` (ISO 8601 UTC). The proxy ensures these stay in sync by:

1. Stamping `creation_time` to UTC "now" at encode time
2. Sending a `TELEMETRY_UPDATE` with matching `telemetry_timestamp` right before each segment relay

This keeps drift within the backend's 10s tolerance.
