
# NewsGenie Intelligent Decision Engine
# Video Simulator User Manual

---

## NewsGenie Stream Simulator — Frontend User Guide

### Setup

```
# Prerequisites: Node.js 18+
npm install
npm run dev
```

App runs at http://localhost:5173 by default.

---

### Layout

The UI has 3 columns:

| Left Column | Middle Column | Right Column |
|---|---|---|
| Server Config | CLIP Upload | Event Log |
| Start Stream | Telemetry & Claims | |
| Video Streaming | Trust Index Calculator | |

Live Audit Results appear above the grid when the backend returns Layer 6 decisions.

---

## Flows

### Flow 1: Live Streaming (WebSocket)

This simulates a mobile device streaming live video fragments to the backend in real-time.

#### Step 1 — Server Config

- Select backend from dropdown:
  - **Dev (staging)** — https://dev.staging.newsgenie.ai
  - **UAT (staging)** — https://uat.staging.newsgenie.ai
  - **Localhost:8080** — http://localhost:8080
- Or type a custom URL in the text input below.
- Click **Check Backend Health** → hits `GET /api/healthCheck`.
- Status shows HEALTHY ✓ (green) or FAILED/ERROR (red).

#### Step 2 — Configure Telemetry

- Set **Claimed Lat/Lon** — the GPS coordinates the device claims.
- Set **Claimed Location Caption** — human-readable location (e.g. "Chennai, Tamil Nadu").
- Set **Claimed Time** — the timestamp the device claims. Use ±1m buttons or click **Now**.
- Set device info: Manufacturer, Model, SDK, Release.
- Set Geo Accuracy (m) and Network Offset (ms).
- These are sent as the first WebSocket message after connecting.
- Default values are pre-filled.

#### Step 3 — Start Stream

- Set the **Uploader ID** (UUID). A default is pre-filled.
- Optionally set an **Incident ID** to link to an existing incident.
- Set **User Type**: `normal` or `journalist`.
- Set **Event Type**: `Crime`, `Violence`, `Emergency`, `Public Safety`, `Protest`, `Civil Unrest`, `Disaster`, `Major Incident`, `Conflict`, `Military Activity`, `Celebrity`, `Sports`, `Entertainment`, `General`.
- Select **Mode**: `STREAMING`.
- Click **Start Stream** → hits `POST /api/v1/start-stream`.
- On success, `session_id` auto-fills in the Video Streaming panel.

**Request:**
```json
{
  "uploader_id": "550e8400-e29b-41d4-a716-446655440000",
  "user_type": "normal",
  "event_type": "Crime",
  "mode": "STREAMING"
}
```
> Note: `incident_id` is only included when non-empty.

**Response (201):**
```json
{
  "status": "success",
  "session_id": "a1b2c3d4-...",
  "stream_name": "ng-live-stream-a1b2c3d4-...",
  "video_id": "770e8400-...",
  "message": "Stream created and active"
}
```

#### Step 4 — Load Video File

- In the Video Streaming panel, select a video file.
- The file is split into ~10s base64 segments.
- A preview player and segment count appear.

#### Step 5 — Connect WebSocket

- Click **Connect WebSocket** → opens `WSS /api/v1/ws/stream/`.
- On connect, metadata is sent automatically as the first JSON message.
- Status changes to **WS CONNECTED**.

**First WebSocket message (JSON text frame):**
```json
{
  "uploader_id": "550e8400-e29b-41d4-a716-446655440000",
  "user_type": "normal",
  "event_type": "Crime",
  "session_id": "a1b2c3d4-...",
  "createdAt": "2025-06-13T10:00:00Z",
  "claimed_location": {
    "caption": "Chennai, Tamil Nadu",
    "latitude": 12.842,
    "longitude": 80.226
  },
  "video": null,
  "telemetry": {
    "telemetry_timestamp": 1742292000000,
    "telemetry_iso": "2025-03-18T10:00:00.000Z",
    "network_time_offset_ms": 50,
    "device_manufacturer": "Samsung",
    "device_model": "Galaxy S24",
    "android_sdk": 34,
    "android_release": "14",
    "capture_mode": "STREAMING",
    "device_lat": 12.842,
    "device_lon": 80.226,
    "geo_accuracy_m": 15.0
  }
}
```

#### Step 6 — Stream

- Click **Stream** → segments are sent one-by-one over the WebSocket.
- Each segment is sent after the backend responds to the previous one (ACK-driven).
- Progress bar and segment counter update in real-time.
- Backend processes each fragment through the 6-layer trust pipeline and returns a decision.
- **Audit Result Cards** appear at the top showing PASS/SOFT_REJECT/HARD_REJECT with scores.
- **Trust Index Calculator** auto-populates with the latest scores.
- Status shows **STREAMING** while active, **COMPLETE** when all segments are sent.

**Subsequent messages:** base64-encoded video chunk bytes as text frames.

**Response per chunk:**
```json
{
  "schema_version": "2026-03-05",
  "job": {
    "session_id": "a1b2c3d4-...",
    "completed_at_ms": 1742292010000,
    "status": "SUCCESS",
    "mode": "STREAMING"
  },
  "layer6": {
    "input_scores": {
      "mas_score": 88,
      "cis_score": 100,
      "srs_score": 85,
      "ndi_score": 15,
      "eis_score": 40
    },
    "policy_evaluation": {
      "trustworthiness_index": 78.5,
      "hard_fail_check": false,
      "restrict_label_check": false,
      "trusted_qualification": true,
      "mode_specific_logic": {
        "clip_mode_tolerance": false,
        "streaming_restrictions_applied": false
      }
    },
    "decision": {
      "policy_status": "PASS",
      "send_to_human_review": false,
      "trust_badge_awarded": true
    },
    "audit": {
      "audit_tags": ["trusted_content", "high_authenticity", "streaming_mode"]
    }
  },
  "quality_feedback": {
    "chunk_quality_score": 86,
    "overall_video_score": 85
  },
  "incident_id": null
}
```

#### Step 7 — Stop

Click **Stop** at any time to:
- Halt segment sending
- Close the WebSocket connection
- Call `POST /api/v1/end-stream` with `{ session_id, uploader_id }` — this triggers the backend to assemble PASS fragments from KVS into a final MP4 and upload to S3.

**Request:**
```json
{
  "session_id": "a1b2c3d4-...",
  "uploader_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response (200):**
```json
{
  "status": "success",
  "s3_path": "s3://bucket/streams/2025/03/18/770e8400-....mp4",
  "reason": "The video shows a peaceful racial justice protest with a large crowd holding signs and demonstrating without visible violence or emergency vehicles. It was rejected due to severe timestamp drift of approximately 49.8 hours, evidence of editing tools and re-encoding, missing device identification tags, and a low source reliability score of 25, despite the high news significance of the demonstration.",
  "message": "Stream ended successfully"
}
```
> Note: The `reason` field contains the final AI-generated explanation summarizing why the video was accepted or rejected across all streamed fragments.

---

### Flow 2: CLIP Upload (Direct POST)

This simulates uploading a pre-recorded video. No session or WebSocket needed.

#### Step 1 — Server Config

- Same as above.

#### Step 2 — Configure Telemetry & Uploader

- Set **Uploader ID** in the Start Stream panel (it's shared across both flows).
- Optionally set **Incident ID**.
- Select **User Type** and **Event Type**.
- Configure telemetry values (claimed location, time, device info).

#### Step 3 — Upload

- In the **CLIP Upload** panel (middle column), select a video file.
- Click **Upload Video** → hits `POST /api/v1/upload-video` with multipart form data.

**Form fields sent:**

| Field | Type | Value |
|---|---|---|
| video | File | The video file (.mp4/.mkv/.mov/.avi) |
| uploader_id | string | UUID string |
| user_type | string | "normal" or "journalist" |
| event_type | string | Event category |
| incident_id | string | Only sent if non-empty |
| telemetry | string (JSON) | See below |

**Telemetry JSON value:**
```json
{
  "telemetry_timestamp": 1742292000000,
  "telemetry_iso": "2025-03-18T10:00:00.000Z",
  "network_time_offset_ms": 50,
  "device_manufacturer": "Samsung",
  "device_model": "Galaxy S24",
  "android_sdk": 34,
  "android_release": "14",
  "capture_mode": "CLIP",
  "device_lat": 12.842,
  "device_lon": 80.226,
  "geo_accuracy_m": 15.0,
  "claimed_location": {
    "caption": "Chennai, Tamil Nadu",
    "latitude": 12.842,
    "longitude": 80.226
  }
}
```

**Response (201):**
```json
{
  "schema_version": "2026-03-05",
  "job": {
    "session_id": "1b7b7603-ad49-44a7-8df7-09e3cc1b1cfb",
    "completed_at_ms": 1778761316021,
    "status": "SUCCESS",
    "mode": "CLIP"
  },
  "layer6": {
    "input_scores": {
      "mas_score": 45,
      "cis_score": 100,
      "srs_score": 25,
      "ndi_score": 10,
      "eis_score": 65
    },
    "policy_evaluation": {
      "trustworthiness_index": 71.5,
      "hard_fail_check": true,
      "restrict_label_check": false,
      "trusted_qualification": false,
      "mode_specific_logic": {
        "clip_mode_tolerance": true,
        "streaming_restrictions_applied": false
      }
    },
    "decision": {
      "policy_status": "HARD_REJECT",
      "send_to_human_review": false,
      "trust_badge_awarded": false
    },
    "audit": {
      "audit_tags": [
        "trusted_content",
        "verified_location",
        "low_narrative_distortion",
        "metadata_tampering",
        "low_reliability_source",
        "re_encoded_video",
        "clip_mode"
      ]
    }
  },
  "quality_feedback": {
    "chunk_quality_score": 96,
    "overall_video_score": 96
  },
  "video_id": "bbf8d18b-1493-4eb1-834b-9375d0fb2b92",
  "reason": "The video shows a peaceful racial justice protest with a large crowd holding signs and demonstrating without visible violence or emergency vehicles. It was rejected due to severe timestamp drift of approximately 49.8 hours, evidence of editing tools and re-encoding, missing device identification tags, and a low source reliability score of 25, despite the high news significance of the demonstration."
}
```

- **Audit Result Card** and **Trust Index Calculator** auto-populate from the response.
- The `reason` field contains the AI-generated explanation of why the video was accepted or rejected.

---

## Trust Index Calculator

Located in the middle column. Computes a real-time weighted trustworthiness score from the 5 Layer 6 input scores — auto-populated from backend responses and manually editable for simulation — where NDI is inverted (lower deepfake probability = higher trust), resulting in a color-coded TRUSTED (≥70, green) or UNTRUSTED (<70, red) verdict.

| Score | Weight | Notes |
|---|---|---|
| MAS (Media Authenticity Score) | 7.5% | Higher = more authentic |
| CIS (Content Integrity Score) | 7.5% | Higher = more intact |
| SRS (Source Reliability Score) | 10% | Higher = more reliable source |
| NDI (Neural Deepfake Index) | 37.5% | **Inverted**: displayed as-is, calculated as (100 - NDI) |
| EIS (EXIF Integrity Score) | 37.5% | Higher = cleaner metadata |

**Formula:** `TI = (MAS×7.5 + CIS×7.5 + SRS×10 + (100-NDI)×37.5 + EIS×37.5) / 100`

- **Green (≥ 70):** TRUSTED
- **Red (< 70):** UNTRUSTED

> Note: NDI is displayed as the original value from the response but inverted internally for calculation. A low NDI (e.g. 10) means low deepfake probability, which contributes positively (100−10=90) to the Trust Index.

---

## Live Audit Results

Displayed above the grid when the backend returns Layer 6 decisions. Each card shows:

- **Policy Status:** PASS (green), SOFT_REJECT (yellow), HARD_REJECT (red)
- **Scores:** MAS, CIS, SRS, NDI, EIS, TI
- **Segment index** and **timestamp**
- **Reason** (if rejection)

Click **×** to dismiss individual cards, or **Clear All** to remove all.

---

## UI Controls Reference

| Control | Location | Action |
|---|---|---|
| Backend URL dropdown | Server Config | Select Dev/UAT/Localhost or custom URL |
| Check Backend Health | Server Config | `GET /api/healthCheck` |
| Start Stream button | Start Stream panel | `POST /api/v1/start-stream` |
| Connect WebSocket | Video Streaming panel | Opens WSS connection + sends metadata |
| Stream button | Video Streaming panel | Starts sending video segments |
| Stop button | Video Streaming panel | Closes WS + `POST /api/v1/end-stream` |
| Upload Video button | CLIP Upload panel | `POST /api/v1/upload-video` (multipart) |
| Clear Log button | Video Streaming / Event Log | Clears the event log |
| Reset All button | Top right | Closes WS, clears all state, resets to defaults |

---

## Status Indicators

| Status | Meaning |
|---|---|
| IDLE | No activity |
| STREAM READY | Session created, ready to connect WS |
| WS CONNECTED | WebSocket open, metadata sent |
| STREAMING | Actively sending segments |
| COMPLETE | All segments sent successfully |
| STOPPED | Manually stopped, end-stream called |
| DISCONNECTED | WebSocket closed |
| WS ERROR | WebSocket connection error |

---

## Event Log

The right column shows a timestamped log of all activity:

- **Blue** — info messages
- **Purple** — outgoing requests (send)
- **Green** — incoming responses (recv)
- **Red** — errors
- **Yellow** — warnings

All API requests, responses, WebSocket events, and errors are logged here.

---

## Notes

- Telemetry values can be changed at any time before connecting the WebSocket. Once the WS connects, the telemetry snapshot sent in the first message is what the backend uses.
- The **Mode** selector (STREAMING/CLIP) in Start Stream also updates `capture_mode` in telemetry automatically.
- Video files are base64-encoded client-side before sending over WebSocket. Large files will take more memory.
- The CLIP upload flow is independent — it doesn't require Start Stream or a WebSocket connection.
- `claimed_time` drives `telemetry_timestamp` (epoch ms) and `telemetry_iso` (ISO string). Adjust it to simulate time discrepancies.
- `claimed_location` (caption + lat/lon) is derived from the telemetry lat/lon and caption fields.
- The `reason` field in end-stream and upload responses is an AI-generated natural language summary explaining the trust decision across all analyzed content.
