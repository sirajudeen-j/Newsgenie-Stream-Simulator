"""EXIF Embedding Proxy — high-fidelity metadata injection using ffmpeg.

Replicates the exact embedding and fingerprint-stripping logic of embed_metadata.py
to produce "virgin" device recordings or "poisoned" forensic test cases.

Usage:
    python exif_proxy.py [port]
"""
import os
import sys
import json
import base64
import logging
import subprocess
import tempfile
import shutil
import asyncio
from typing import Optional

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import Response, JSONResponse, StreamingResponse
import httpx
import traceback
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="NewsGenie Forensic Proxy", version="3.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# Load Metadata Template globally for the Bridge
metadataTemplate = {}
if os.path.exists("metadata.json"):
    try:
        with open("metadata.json", "r") as f:
            metadataTemplate = json.load(f)
        logger.info("Loaded metadata.json template ✓")
    except Exception as e:
        logger.error("Failed to load metadata.json: %s", e)

# --- STATEFUL SESSION STORAGE ---
SESSIONS = {} # session_id -> { "video_path": str, "latest_forensics": dict }

# --- LIVE SEGMENT ACCUMULATOR ---
# Buffers small live chunks (5s each) until we have 10s for BE
LIVE_CHUNK_DURATION_S = 5
TARGET_SEGMENT_DURATION_S = 10
CHUNKS_PER_SEGMENT = 2  # 2 × 5s = 10s exactly

# --- SESSION UPLOAD ROUTES (FOR FILE MODE) ---
@app.options("/session/upload/{session_id}")
async def upload_options(session_id: str):
    return Response(status_code=200, headers={
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
    })

@app.post("/session/upload/{session_id}")
async def upload_session_source(session_id: str, request: Request):
    """Stores the full source video on the proxy for segmenting."""
    storage_dir = os.path.join("forensic_segments", session_id)
    os.makedirs(storage_dir, exist_ok=True)
    source_path = os.path.join(storage_dir, "source.mp4")
    
    logger.info("📡 STAGING: Starting upload for session %s...", session_id)
    total_bytes = 0
    try:
        with open(source_path, "wb") as f:
            async for chunk in request.stream():
                f.write(chunk)
                total_bytes += len(chunk)
                if total_bytes % (1024 * 1024) < len(chunk): # Log every 1MB
                    logger.info("... %d MB received ...", total_bytes // (1024 * 1024))
        
        # Register in SESSIONS so the WebSocket bridge can find it
        SESSIONS[session_id] = {
            "video_path": source_path,
            "work_dir": storage_dir,
            "latest_forensics": {}
        }
        
        logger.info("✅ STAGED: %s (%d MB)", source_path, total_bytes // (1024 * 1024))
        return JSONResponse(content={"status": "staged", "path": source_path, "bytes": total_bytes})
    except Exception as e:
        logger.error("❌ STAGING FAILED: %s", e)
        return JSONResponse(status_code=500, content={"error": str(e)})

# --- THE VPN GATEWAY RELAY (Streaming with Length) ---
@app.api_route("/relay/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])
@app.api_route("/health/relay/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])
async def relay_to_backend(path: str, request: Request):
    if request.method == "OPTIONS":
        return Response(status_code=200, headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "*",
            "Access-Control-Allow-Headers": "*"
        })

    be_base = request.headers.get("X-Backend-Base")
    if not be_base:
        return JSONResponse(status_code=400, content={"error": "Missing X-Backend-Base header"})
    
    url = f"{be_base.rstrip('/')}/{path}"
    method = request.method
    content_length = request.headers.get("content-length")
    
    if "healthCheck" in path:
        logger.info("❤️  HEALTH CHECK RELAY: %s", url)
    else:
        logger.info("🚀 RELAY START: %s %s (%s bytes)", method, url, content_length or "unknown")

    # Copy headers but let httpx handle Host
    headers = {k: v for k, v in request.headers.items() 
               if k.lower() not in ["host", "x-backend-base", "accept-encoding"]}

    try:
        # We use a manual streaming relay to prevent timeouts and log progress
        async with httpx.AsyncClient(verify=False) as client:
            # If we have a content-length, httpx will use it and NOT use chunked encoding!
            # This is the best of both worlds.
            logger.info("🌊 STREAMING RELAY: Pumping %s to BE...", content_length or "unknown size")
            
            async def stream_with_logs():
                total = 0
                async for chunk in request.stream():
                    total += len(chunk)
                    # Log every ~1MB
                    if total % (1024 * 1024) < len(chunk):
                        logger.info("... %d bytes received ...", total)
                    yield chunk

            resp = await client.request(
                method,
                url,
                content=stream_with_logs(),
                headers=headers,
                params=request.query_params,
                timeout=600.0 # 10 Minute BE timeout
            )
            
            if resp.status_code >= 400:
                logger.error("❌ BE REJECTED (%d): %s", resp.status_code, resp.text)
            else:
                logger.info("✅ RELAY COMPLETE: %s -> %d", url, resp.status_code)
            
            resp_headers = dict(resp.headers)
            # Ensure CORS is allowed for the browser even in relay
            resp_headers["Access-Control-Allow-Origin"] = "*"
            resp_headers["Access-Control-Allow-Methods"] = "*"
            resp_headers["Access-Control-Allow-Headers"] = "*"

            return Response(
                content=resp.content,
                status_code=resp.status_code,
                headers=resp_headers
            )
            
    except Exception:
        err_msg = traceback.format_exc()
        logger.error("❌ Relay failed:\n%s", err_msg)
        return JSONResponse(status_code=502, content={"error": "Check Proxy Terminal for Traceback"})

@app.post("/embed-exif")
async def embed_exif(request: Request):
    """
    Embed metadata using the 'Bit-Exact' method from embed_metadata.py.
    
    Request JSON:
        data (str): base64-encoded video chunk.
        exif_template (dict): Full metadata structure (like metadata.json).
        overrides (dict): Optional dynamic overrides (lat, lon, model, etc.)
        fingerprint (bool): If true, do NOT strip encoder tags (simulates editing).
        strip_audio (bool): If true, remove audio stream.
    """
    body = await request.json()
    chunk_b64 = body.get("data", "")
    metadata = body.get("exif_template", {})
    overrides = body.get("overrides", {})
    fingerprint = body.get("fingerprint", False)
    strip_audio = body.get("strip_audio", False)

    try:
        chunk_bytes = base64.b64decode(chunk_b64)
    except Exception:
        return Response(status_code=400, content=b"Invalid base64")

    if not chunk_bytes:
        return Response(status_code=400, content=b"Empty video data")

    in_tmp = None
    out_tmp = None
    try:
        # Write input to temp
        in_fd = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
        in_fd.write(chunk_bytes)
        in_fd.close()
        in_tmp = in_fd.name

        out_fd = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
        out_fd.close()
        out_tmp = out_fd.name

        # --- Build FFmpeg Command ---
        cmd = ["ffmpeg", "-y", "-i", in_tmp]

        # Audio handling
        if strip_audio:
            cmd.extend(["-an", "-c:v", "copy"])
        else:
            cmd.extend(["-c", "copy"])

        # Map original metadata
        cmd.extend(["-map_metadata", "0", "-map_metadata:s:v", "0:s:v", "-map_metadata:s:a", "0:s:a"])

        # --- Apply Metadata from Template ---
        fmt_tags = metadata.get("format", {}).get("tags", {})
        
        # Apply Overrides to Template
        if overrides.get("lat") is not None and overrides.get("lon") is not None:
            loc_str = f"{float(overrides['lat']):+.4f}{float(overrides['lon']):+08.4f}/"
            fmt_tags["location"] = loc_str
            fmt_tags["location-eng"] = loc_str
        
        if overrides.get("model"):
            fmt_tags["com.android.model"] = overrides["model"]
        if overrides.get("manufacturer"):
            fmt_tags["com.android.manufacturer"] = overrides["manufacturer"]
        if overrides.get("creation_time"):
            fmt_tags["creation_time"] = overrides["creation_time"]

        # Flatten tags into -metadata arguments
        for k, v in fmt_tags.items():
            cmd.extend(["-metadata", f"{k}={v}"])

        # --- Fingerprint Stripping (The "Bit-Exact" Logic) ---
        if not fingerprint:
            cmd.extend([
                "-metadata", "encoder=",
                "-metadata:s:v", "encoder=",
                "-metadata:s:a", "encoder=",
                "-vendor", "",
                "-fflags", "+bitexact"
            ])
            logger.info("Stripping fingerprints (Bit-Exact mode ON)")
        else:
            logger.info("Preserving fingerprints (Forensic Leak mode ON)")

        # Move moov atom to front for streaming compatibility
        cmd.extend(["-movflags", "+faststart+use_metadata_tags", "-brand", "mp42", "-f", "mp4", out_tmp])

        # Run ffmpeg
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)

        if proc.returncode == 0:
            with open(out_tmp, "rb") as f:
                modified = f.read()
            return Response(content=base64.b64encode(modified), media_type="text/plain")
        else:
            logger.error("ffmpeg failed: %s", proc.stderr)
            return JSONResponse(status_code=500, content={"error": "ffmpeg failed", "stderr": proc.stderr})

    except Exception as e:
        logger.error("Proxy error: %s", e)
        return JSONResponse(status_code=500, content={"error": str(e)})
    finally:
        for p in [in_tmp, out_tmp]:
            if p and os.path.exists(p):
                os.remove(p)

@app.post("/segment-video")
async def segment_video(request: Request):
    """
    1. Embed forensics into the WHOLE file.
    2. Segment the poisoned file into valid standalone TS fragments.
    3. Return a list of base64 fragments.
    """
    body = await request.json()
    chunk_b64 = body.get("data", "")
    metadata = body.get("exif_template", {})
    overrides = body.get("overrides", {})
    fingerprint = body.get("fingerprint", False)
    strip_audio = body.get("strip_audio", False)
    seg_time = body.get("segment_time", 10)

    try:
        chunk_bytes = base64.b64decode(chunk_b64)
    except Exception:
        return Response(status_code=400, content=b"Invalid base64")

    work_dir = tempfile.mkdtemp()
    in_tmp = os.path.join(work_dir, "input.mp4")
    poisoned_tmp = os.path.join(work_dir, "poisoned.mp4")
    
    try:
        with open(in_tmp, "wb") as f:
            f.write(chunk_bytes)

        # Step 1: Embed (identical logic to /embed-exif)
        cmd = ["ffmpeg", "-y", "-i", in_tmp]
        if strip_audio: cmd.extend(["-an", "-c:v", "copy"])
        else: cmd.extend(["-c", "copy"])
        cmd.extend(["-map_metadata", "0", "-map_metadata:s:v", "0:s:v", "-map_metadata:s:a", "0:s:a"])
        
        fmt_tags = metadata.get("format", {}).get("tags", {})
        if overrides.get("lat") and overrides.get("lon"):
            loc = f"{float(overrides['lat']):+.4f}{float(overrides['lon']):+08.4f}/"
            fmt_tags["location"] = loc
            fmt_tags["location-eng"] = loc
        if overrides.get("model"): fmt_tags["com.android.model"] = overrides["model"]
        if overrides.get("manufacturer"): fmt_tags["com.android.manufacturer"] = overrides["manufacturer"]
        if overrides.get("creation_time"): fmt_tags["creation_time"] = overrides["creation_time"]

        for k, v in fmt_tags.items():
            cmd.extend(["-metadata", f"{k}={v}"])
        
        if not fingerprint:
            cmd.extend(["-metadata", "encoder=", "-metadata:s:v", "encoder=", "-metadata:s:a", "encoder=", "-vendor", "", "-fflags", "+bitexact"])
        
        cmd.extend(["-movflags", "+faststart+use_metadata_tags", "-brand", "mp42", poisoned_tmp])
        subprocess.run(cmd, capture_output=True, check=True)

        # Step 2: Segment into TS (TS is ideal for fragments as it has headers in every packet)
        seg_pattern = os.path.join(work_dir, "seg_%03d.ts")
        seg_cmd = [
            "ffmpeg", "-i", poisoned_tmp,
            "-f", "segment",
            "-segment_time", str(seg_time),
            "-c", "copy",
            "-muxdelay", "0",
            seg_pattern
        ]
        subprocess.run(seg_cmd, capture_output=True, check=True)

        # Step 3: Collect fragments
        fragments = []
        for f_name in sorted(os.listdir(work_dir)):
            if f_name.startswith("seg_") and f_name.endswith(".ts"):
                with open(os.path.join(work_dir, f_name), "rb") as f:
                    fragments.append(base64.b64encode(f.read()).decode())
        
        return JSONResponse(content={"fragments": fragments})

    except Exception as e:
        logger.error("Segmentation failed: %s", e)
        return JSONResponse(status_code=500, content={"error": str(e)})
    finally:
        import shutil
        shutil.rmtree(work_dir, ignore_errors=True)

# --- WEB SOCKET RELAY (THE BRIDGE) ---
import websockets
import asyncio

@app.websocket("/ws/bridge")
async def websocket_bridge(websocket: WebSocket):
    await websocket.accept()
    logger.info("React connected to Forensic Bridge")
    
    be_ws = None
    session_id = None
    
    try:
        # --- DUAL-WORKER PIPELINE ---
        # 1. Builder: Receives from FE -> FFmpeg -> Save Local -> Queue for Relay
        # 2. Courier: Takes from Relay Queue -> Send to BE -> Wait indefinitely for ACK
        
        builder_queue = asyncio.Queue()
        courier_queue = asyncio.Queue() # Stores (index, base64_data)
        
        t1 = None
        t2 = None
        
        be_ack_event = asyncio.Event()
        be_ack_event.set() # Start open
        
        # --- WORKER 1: THE BUILDER (Fast) --- (Used for FILE_CHUNK mode only now)
        async def builder_worker():
            while True:
                item = await builder_queue.get()
                try:
                    meta, binary_data = item
                    overrides = meta.get("forensic_overrides", {})
                    sess_id = meta.get("session_id")
                    idx = meta.get("segment_index", 0)
                    
                    blob_b64 = base64.b64encode(binary_data).decode('utf-8')
                    
                    p_b64 = await poison_live_blob(blob_b64, metadataTemplate, overrides, sess_id)
                    
                    # Save local copy
                    s_dir = f"captures/{sess_id}"
                    os.makedirs(s_dir, exist_ok=True)
                    with open(f"{s_dir}/live_seg_{idx:03d}.mp4", "wb") as f:
                        f.write(base64.b64decode(p_b64))
                    logger.info("Builder: Segment %d done ✓", idx)
                    
                    await courier_queue.put((idx, p_b64))
                except Exception as e:
                    logger.error("Builder failed segment %d: %s", idx if 'idx' in dir() else 0, e)
                finally:
                    builder_queue.task_done()

        # --- WORKER 2: THE COURIER (Disciplined) ---
        async def courier_worker():
            while True:
                idx, p_b64 = await courier_queue.get()
                try:
                    # WAIT INDEFINITELY for Backend to be ready
                    await be_ack_event.wait()
                    be_ack_event.clear()
                    
                    if be_ws:
                        try:
                            await be_ws.send(p_b64)
                            logger.info("Courier: Relayed Segment %d to BE. Waiting for ACK...", idx)
                        except Exception as relay_err:
                            logger.error("Courier: Relay failed for segment %d: %s", idx, relay_err)
                            be_ack_event.set() # Don't hang if connection dies
                except Exception as e:
                    logger.error("Courier error: %s", e)
                finally:
                    courier_queue.task_done()

        # Start both workers
        t1 = asyncio.create_task(builder_worker())
        t2 = asyncio.create_task(courier_worker())

        while True:
            data = await websocket.receive_text()
            if not data or not data.strip(): continue

            try:
                msg = json.loads(data)
            except json.JSONDecodeError:
                continue
            
            # 1. Handle Metadata / Connection Init
            if "backend_ws_url" in msg:
                be_url = msg.get("backend_ws_url")
                session_id = msg.get("session_id")
                logger.info("DEBUG: Received Bridge Init for session %s", session_id)
                if not be_url:
                    await websocket.send_json({"type": "ERROR", "message": "No backend_ws_url"})
                    continue
                
                logger.info("Connecting Bridge to BE: %s", be_url)
                try:
                    import ssl
                    ssl_context = ssl._create_unverified_context()
                    be_ws = await websockets.connect(be_url, max_size=100 * 1024 * 1024, ssl=ssl_context)
                    be_meta = msg.copy()
                    be_meta.pop("backend_ws_url", None)
                    
                    await be_ws.send(json.dumps(be_meta))
                    
                    async def pipe_be_to_react():
                        try:
                            async for response in be_ws:
                                logger.info("DEBUG: BE Response Received -> Forwarding to React")
                                be_ack_event.set()
                                await websocket.send_text(response)
                        except Exception as e:
                            logger.error("DEBUG: Bridge pipe error: %s", e)
                            be_ack_event.set()
                    
                    asyncio.create_task(pipe_be_to_react())
                    logger.info("Bridge Pipe Established ✓")
                    
                except Exception as e:
                    logger.error("Failed to connect to BE: %s", e)
                    await websocket.send_json({"type": "ERROR", "message": f"BE Connection Failed: {str(e)}"})
                    continue

            # 2. Handle Telemetry Updates (forward to BE + store locally)
            elif msg.get("type") == "TELEMETRY_UPDATE":
                tel_data = msg.get("data", {})
                if session_id and session_id in SESSIONS:
                    SESSIONS[session_id]["latest_forensics"] = tel_data
                if be_ws and be_ack_event.is_set():
                    try:
                        await be_ws.send(json.dumps(msg))
                        logger.info("TELEMETRY_UPDATE forwarded to BE for session %s", session_id)
                    except Exception as e:
                        logger.warning("Failed to forward telemetry to BE: %s", e)
                continue

            # 3. Handle FILE CHUNKS (FE-cut segments with EXIF)
            elif msg.get("type") == "FILE_CHUNK":
                idx = msg.get("segment_index", 0)
                if not be_ws:
                    await websocket.send_json({"type": "ERROR", "message": "Bridge not initialized."})
                    continue
                
                try:
                    b64_data = msg.get("blob_b64")
                    if not b64_data:
                        logger.error("[Seg %d] FILE_CHUNK missing blob_b64!", idx)
                        continue
                    
                    overrides = msg.get("forensic_overrides", {})
                    exif_template = msg.get("exif_template", metadataTemplate)
                    sess_id = msg.get("session_id", session_id)
                    
                    logger.info("[Seg %d] FILE_CHUNK received. Poisoning...", idx)
                    
                    # Poison the segment (embed EXIF + re-encode)
                    p_b64 = await poison_live_blob(b64_data, exif_template, overrides, sess_id)
                    
                    # Save local copy
                    s_dir = f"captures/{sess_id}"
                    os.makedirs(s_dir, exist_ok=True)
                    with open(f"{s_dir}/live_seg_{idx:03d}.mp4", "wb") as f:
                        f.write(base64.b64decode(p_b64))
                    
                    # Relay directly to BE
                    await be_ack_event.wait()
                    be_ack_event.clear()
                    await be_ws.send(p_b64)
                    logger.info("[Seg %d] Poisoned & Relayed to BE ✓", idx)
                    
                    # ACK back to FE
                    await websocket.send_json({
                        "type": "PROXY_ACK",
                        "segment_index": idx,
                        "message": f"Segment {idx} poisoned & sent to BE"
                    })
                except Exception as e:
                    logger.error("[Seg %d] FILE_CHUNK failed: %s", idx, e)
                    await websocket.send_json({"type": "ERROR", "message": str(e)})
                    be_ack_event.set()

            # 4. Handle LIVE Camera Fragments (Unified Frame) — ACCUMULATE then relay
            elif msg.get("type") == "LIVE_CHUNK_META":
                idx = msg.get("segment_index", 0)
                if not be_ws:
                    await websocket.send_json({"type": "ERROR", "message": "Bridge not initialized."})
                    continue
                
                try:
                    b64_data = msg.get("blob_b64")
                    if not b64_data:
                        logger.error("DEBUG: [Seg %d] Unified frame missing blob_b64!", idx)
                        continue
                        
                    binary_data = base64.b64decode(b64_data)
                    logger.info("DEBUG: [Seg %d] Live chunk received (%d bytes). Buffering...", idx, len(binary_data))
                    
                    # Save chunk to disk for accumulation
                    chunk_dir = os.path.join("live_chunks", session_id or "unknown")
                    os.makedirs(chunk_dir, exist_ok=True)
                    chunk_path = os.path.join(chunk_dir, f"chunk_{idx:04d}.webm")
                    with open(chunk_path, "wb") as f:
                        f.write(binary_data)
                    
                    # Track chunks in accumulator
                    if "live_chunk_buffer" not in SESSIONS.get(session_id, {}):
                        if session_id not in SESSIONS:
                            SESSIONS[session_id] = {}
                        SESSIONS[session_id]["live_chunk_buffer"] = []
                        SESSIONS[session_id]["live_segment_counter"] = 0
                    
                    SESSIONS[session_id]["live_chunk_buffer"].append(chunk_path)
                    buffer = SESSIONS[session_id]["live_chunk_buffer"]
                    
                    # ACK immediately so FE keeps recording
                    await websocket.send_json({
                        "type": "PROXY_ACK",
                        "segment_index": idx,
                        "message": f"Buffered ({len(buffer)}/{CHUNKS_PER_SEGMENT})"
                    })
                    
                    # Once we have enough chunks, concatenate and relay as one 10s segment
                    if len(buffer) >= CHUNKS_PER_SEGMENT:
                        SESSIONS[session_id]["live_segment_counter"] += 1
                        seg_num = SESSIONS[session_id]["live_segment_counter"]
                        chunks_to_merge = buffer[:CHUNKS_PER_SEGMENT]
                        SESSIONS[session_id]["live_chunk_buffer"] = buffer[CHUNKS_PER_SEGMENT:]
                        
                        overrides = msg.get("forensic_overrides", {})
                        
                        logger.info("🔗 Merging %d chunks into 10s segment #%d...", len(chunks_to_merge), seg_num)
                        
                        merged_b64 = await merge_and_poison_chunks(
                            chunks_to_merge, metadataTemplate, overrides, session_id, seg_num
                        )
                        
                        if merged_b64:
                            # Queue for courier (respects BE ACK flow)
                            await courier_queue.put((seg_num, merged_b64))
                            logger.info("✅ 10s Segment #%d queued for BE relay", seg_num)
                        else:
                            logger.error("❌ Merge failed for segment #%d", seg_num)
                        
                        # Cleanup merged chunk files
                        for cp in chunks_to_merge:
                            try: os.remove(cp)
                            except: pass
                    
                except Exception as e:
                    logger.warning("DEBUG: [Seg %d] Failed to process unified frame: %s", idx, e)
                    break

            # 4. Handle Segment Requests (Source-Based / Staged)
            elif "segment_index" in msg:
                if not be_ws:
                    await websocket.send_json({"type": "ERROR", "message": "Bridge not initialized."})
                    continue
                
                if session_id not in SESSIONS:
                    await websocket.send_json({"type": "ERROR", "message": "No source video found."})
                    continue
                
                seg_idx = msg["segment_index"]
                template = msg.get("exif_template", {})
                overrides = SESSIONS[session_id].get("latest_forensics", {})
                
                try:
                    video_path = SESSIONS[session_id]["video_path"]
                    processed_b64 = await cut_and_poison(
                        video_path,
                        seg_idx,
                        template,
                        overrides,
                        session_id
                    )
                    
                    if be_ws and be_ws.open:
                        await be_ws.send(processed_b64)
                        logger.info("Relayed & Saved Staged Segment %d ✓", seg_idx)
                    else:
                        logger.error("Backend WebSocket closed during staged relay.")
                        break
                        
                except Exception as e:
                    logger.error("Chunking failed: %s", e)
                    await websocket.send_json({"type": "ERROR", "message": str(e)})

    except WebSocketDisconnect:
        logger.warning("React disconnected")
    finally:
        # Flush remaining live chunks (< CHUNKS_PER_SEGMENT) before closing
        if session_id and session_id in SESSIONS:
            remaining = SESSIONS[session_id].get("live_chunk_buffer", [])
            if remaining and be_ws:
                logger.info("🧹 Flushing %d remaining live chunks as final segment...", len(remaining))
                SESSIONS[session_id]["live_segment_counter"] = SESSIONS[session_id].get("live_segment_counter", 0) + 1
                seg_num = SESSIONS[session_id]["live_segment_counter"]
                try:
                    merged_b64 = await merge_and_poison_chunks(
                        remaining, metadataTemplate, {}, session_id, seg_num
                    )
                    if merged_b64:
                        await be_ack_event.wait()
                        await be_ws.send(merged_b64)
                        logger.info("✅ Final flush segment #%d sent to BE", seg_num)
                except Exception as flush_err:
                    logger.error("Flush failed: %s", flush_err)
                SESSIONS[session_id]["live_chunk_buffer"] = []
        
        if t1: t1.cancel()
        if t2: t2.cancel()
        if be_ws: await be_ws.close()
        # Cleanup live_chunks dir
        if session_id:
            chunk_dir = os.path.join("live_chunks", session_id)
            if os.path.exists(chunk_dir):
                shutil.rmtree(chunk_dir, ignore_errors=True)
        logger.info("Forensic Bridge session cleaned up ✓")

async def merge_and_poison_chunks(chunk_paths, metadata, overrides, session_id, seg_num):
    """Concatenates multiple small WebM/MP4 chunks into one ~10s MP4, then poisons it."""
    work_dir = tempfile.mkdtemp()
    concat_list = os.path.join(work_dir, "concat.txt")
    merged_tmp = os.path.join(work_dir, "merged.mp4")
    out_tmp = os.path.join(work_dir, "out.mp4")
    
    storage_dir = os.path.join("forensic_segments", session_id)
    os.makedirs(storage_dir, exist_ok=True)
    stored_path = os.path.join(storage_dir, f"live_10s_seg_{seg_num:03d}.mp4")
    
    try:
        # Step 1: Concat all chunks into one continuous file
        # Use intermediate re-encode per chunk for format consistency
        intermediate_paths = []
        for i, cp in enumerate(chunk_paths):
            inter_path = os.path.join(work_dir, f"inter_{i:03d}.mp4")
            re_cmd = [
                "ffmpeg", "-y",
                "-fflags", "+genpts+discardcorrupt",
                "-err_detect", "ignore_err",
                "-i", cp,
                "-c:v", "libx264", "-preset", "ultrafast", "-crf", "26",
                "-c:a", "aac", "-r", "15",
                "-vf", "scale='min(1920,iw)':-2",
                "-movflags", "+faststart+use_metadata_tags",
                inter_path
            ]
            proc = await asyncio.to_thread(subprocess.run, re_cmd, capture_output=True)
            if proc.returncode == 0 and os.path.getsize(inter_path) > 1000:
                intermediate_paths.append(inter_path)
            else:
                logger.warning("Chunk %d re-encode failed, skipping: %s", i, proc.stderr[-200:])
        
        if not intermediate_paths:
            logger.error("All chunk re-encodes failed!")
            return None
        
        # Write concat list
        with open(concat_list, "w") as f:
            for ip in intermediate_paths:
                f.write(f"file '{ip}'\n")
        
        # Step 2: Concat into single file
        concat_cmd = [
            "ffmpeg", "-y", "-f", "concat", "-safe", "0",
            "-i", concat_list,
            "-c", "copy",
            "-movflags", "+faststart+use_metadata_tags",
            merged_tmp
        ]
        proc = await asyncio.to_thread(subprocess.run, concat_cmd, capture_output=True)
        if proc.returncode != 0:
            logger.error("Concat failed: %s", proc.stderr[-300:])
            return None
        
        # Step 3: Poison (inject metadata)
        cmd = ["ffmpeg", "-y", "-i", merged_tmp, "-c", "copy"]
        
        fmt_tags = {}
        if overrides.get("enabled", True):
            fmt_tags = dict(metadata.get("format", {}).get("tags", {}))
            if overrides.get("lat") and overrides.get("lon"):
                loc = f"{float(overrides['lat']):+.4f}{float(overrides['lon']):+08.4f}/"
                fmt_tags["location"] = loc
                fmt_tags["location-eng"] = loc
            if overrides.get("model"):
                fmt_tags["com.android.model"] = overrides["model"]
            if overrides.get("manufacturer"):
                fmt_tags["com.android.manufacturer"] = overrides["manufacturer"]
            if overrides.get("creation_time"):
                fmt_tags["creation_time"] = overrides["creation_time"]
        
        for k, v in fmt_tags.items():
            cmd.extend(["-metadata", f"{k}={v}"])
        
        cmd.extend([
            "-metadata", "encoder=",
            "-metadata:s:v", "encoder=",
            "-metadata:s:a", "encoder=",
            "-fflags", "+bitexact",
            "-movflags", "+faststart+use_metadata_tags",
            "-brand", "mp42",
            "-f", "mp4", out_tmp
        ])
        
        proc = await asyncio.to_thread(subprocess.run, cmd, capture_output=True)
        if proc.returncode != 0:
            logger.error("Poison failed: %s", proc.stderr[-300:])
            return None
        
        # Save local copy
        shutil.copy2(out_tmp, stored_path)
        logger.info("Merged & Poisoned 10s segment #%d -> %s", seg_num, stored_path)
        
        with open(out_tmp, "rb") as f:
            return base64.b64encode(f.read()).decode()
    except Exception as e:
        logger.error("merge_and_poison_chunks failed: %s", e)
        return None
    finally:
        await asyncio.to_thread(shutil.rmtree, work_dir, ignore_errors=True)


async def poison_live_blob(blob_b64, metadata, overrides, session_id):
    """Transmuxes a raw camera blob (WebM/MP4) into a header-complete poisoned MP4."""
    work_dir = tempfile.mkdtemp()
    in_tmp = os.path.join(work_dir, "input.webm")
    out_tmp = os.path.join(work_dir, "out.mp4")
    
    storage_dir = os.path.join("forensic_segments", session_id)
    os.makedirs(storage_dir, exist_ok=True)
    stored_path = os.path.join(storage_dir, f"live_{int(asyncio.get_event_loop().time())}.mp4")
    
    try:
        with open(in_tmp, "wb") as f:
            f.write(base64.b64decode(blob_b64))
        
        # Re-encode to H.264 MP4 (BE expects proper MP4)
        cmd = [
            "ffmpeg", "-y", "-i", in_tmp, 
            "-vf", "scale='min(1920,iw)':-2",
            "-r", "15",
            "-c:v", "libx264",
            "-preset", "superfast", 
            "-crf", "26",
            "-c:a", "aac",
            "-map_metadata", "0",
            "-threads", "0"
        ]
        
        # Inject metadata if enabled
        fmt_tags = {}
        if overrides.get("enabled", True):
            fmt_tags = dict(metadata.get("format", {}).get("tags", {}))
            if overrides.get("lat") and overrides.get("lon"):
                loc = f"{float(overrides['lat']):+.4f}{float(overrides['lon']):+08.4f}/"
                fmt_tags["location"] = loc
                fmt_tags["location-eng"] = loc
            if overrides.get("model"):
                fmt_tags["com.android.model"] = overrides["model"]
            if overrides.get("manufacturer"):
                fmt_tags["com.android.manufacturer"] = overrides["manufacturer"]
            if overrides.get("creation_time"):
                fmt_tags["creation_time"] = overrides["creation_time"]
        # Always set creation_time to avoid drift (even if injection disabled)
        if "creation_time" not in fmt_tags:
            from datetime import datetime, timezone
            fmt_tags["creation_time"] = overrides.get("creation_time") or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000000Z")
            
        for k, v in fmt_tags.items():
            cmd.extend(["-metadata", f"{k}={v}"])
        
        # Stream-level tags from template
        if overrides.get("enabled", True):
            for stream in metadata.get("streams", []):
                stags = stream.get("tags", {})
                stype = stream.get("codec_type")
                if stype == "video":
                    for sk, sv in stags.items():
                        if sk.lower() != "encoder":
                            cmd.extend([f"-metadata:s:v:0", f"{sk}={sv}"])
                elif stype == "audio":
                    for sk, sv in stags.items():
                        if sk.lower() != "encoder":
                            cmd.extend([f"-metadata:s:a:0", f"{sk}={sv}"])
        
        # Strip encoder fingerprints
        cmd.extend([
            "-metadata", "encoder=",
            "-metadata:s:v", "encoder=",
            "-metadata:s:a", "encoder=",
            "-fflags", "+bitexact",
            "-movflags", "+faststart+use_metadata_tags",
            "-brand", "mp42",
            "-f", "mp4", out_tmp
        ])
        
        def run_ffmpeg():
            return subprocess.run(cmd, capture_output=True, text=True)
            
        process = await asyncio.to_thread(run_ffmpeg)
        
        if process.returncode != 0:
            logger.error("FFmpeg poison failed: %s", process.stderr[-500:])
            raise Exception(f"FFmpeg failed with exit code {process.returncode}")
        
        shutil.copy2(out_tmp, stored_path)
        logger.info("Poisoned & Saved to %s", stored_path)
        
        with open(out_tmp, "rb") as f:
            return base64.b64encode(f.read()).decode()
    except Exception as e:
        logger.error("Poisoning logic failed: %s", e)
        raise
    finally:
        await asyncio.to_thread(shutil.rmtree, work_dir, ignore_errors=True)

async def cut_and_poison(source_path, seg_idx, metadata, overrides, session_id):
    """Cuts exactly 10s from source, injects forensics, and saves a local copy."""
    work_dir = tempfile.mkdtemp()
    seg_tmp = os.path.join(work_dir, "seg.mp4")
    out_tmp = os.path.join(work_dir, "out.mp4") # Switched to MP4
    
    # Persistent storage directory
    storage_dir = os.path.join("forensic_segments", session_id)
    os.makedirs(storage_dir, exist_ok=True)
    stored_path = os.path.join(storage_dir, f"seg_{seg_idx}.mp4")
    
    start_sec = (seg_idx - 1) * 10
    
    try:
        # Step 1: Precise Cut & Normalize (15 FPS, 1080p Cap)
        cut_cmd = [
            "ffmpeg", "-y", "-ss", str(start_sec), "-t", "10",
            "-i", source_path,
            "-vf", "scale='min(1920,iw)':-2", # Cap at 1080p width, keep aspect
            "-r", "15",                       # Force 15 FPS
            "-c:v", "libx264",                # Re-encode to ensure stability
            "-preset", "superfast", 
            "-crf", "23",
            "-c:a", "aac",                    # Unified audio
            "-movflags", "+faststart+use_metadata_tags", 
            "-avoid_negative_ts", "make_zero", seg_tmp
        ]
        await asyncio.to_thread(subprocess.run, cut_cmd, capture_output=True, check=True)
        
        # Step 2: Forensic Injection (ONLY IF ENABLED)
        if overrides.get("enabled", True):
            # Injection now happens on the already normalized segment
            cmd = ["ffmpeg", "-y", "-i", seg_tmp, "-c", "copy"] # Copy because already encoded
            
            fmt_tags = metadata.get("format", {}).get("tags", {})
            if overrides.get("lat") and overrides.get("lon"):
                loc = f"{float(overrides['lat']):+.4f}{float(overrides['lon']):+08.4f}/"
                fmt_tags["location"] = loc
                fmt_tags["location-eng"] = loc
            
            for k, v in fmt_tags.items():
                cmd.extend(["-metadata", f"{k}={v}"])
                
            cmd.extend(["-movflags", "+faststart+use_metadata_tags", out_tmp])
            await asyncio.to_thread(subprocess.run, cmd, capture_output=True, check=True)
        else:
            # Just copy the clean segment
            import shutil
            shutil.copy2(seg_tmp, out_tmp)
            logger.info("Injection disabled — relaying clean segment")
        
        # SAVE LOCAL COPY
        import shutil
        shutil.copy2(out_tmp, stored_path)
        logger.info("Saved local copy to %s", stored_path)
        
        with open(out_tmp, "rb") as f:
            return base64.b64encode(f.read()).decode()
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)

@app.get("/health")
async def health():
    print("Health Check")
    return {"status": "healthy", "service": "newsgenie-forensic-proxy"}

if __name__ == "__main__":
    import uvicorn
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8001
    uvicorn.run(app, host="0.0.0.0", port=port, ws_max_size=100 * 1024 * 1024)
