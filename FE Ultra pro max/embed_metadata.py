"""
Encode a video with custom metadata from a JSON config,
stripping all FFmpeg encoder fingerprints.

Usage:
    python embed_metadata.py <input_video> <metadata_json> [-o output_video] [--scale WxH]

Examples:
    python embed_metadata.py input.mp4 metadata.json --scale 1920x1080
    python embed_metadata.py input.mp4 metadata.json -o output.mp4 --scale 1920x1080

The metadata JSON should follow the ffprobe structure (format.tags, streams[].tags).
You can edit the JSON values to whatever you want embedded in the output.
"""

import subprocess
import json
import sys
import os
import argparse
import threading
import tkinter as tk
from tkinter import filedialog, ttk, messagebox
from pathlib import Path
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
console = Console()

RESOLUTION_PRESETS = {
    "360p": "640x360",
    "480p": "854x480",
    "720p": "1280x720",
    "1080p": "1920x1080",
    "1440p": "2560x1440",
    "4k": "3840x2160",
}

# Tags that FFmpeg injects automatically — we always blank these out
ENCODER_TAGS_TO_STRIP = {
    "container": ["encoder"],
    "video": ["encoder", "handler_name"],
    "audio": ["encoder", "handler_name"],
}


def load_metadata(json_path: str) -> dict:
    with open(json_path, "r", encoding="utf-8") as f:
        return json.load(f)


def build_ffmpeg_cmd(input_path: str, output_path: str, metadata: dict,
                     copy_streams: bool = False, scale: str = None) -> list[str]:
    """
    Build an ffmpeg command that:
      1. Re-encodes (or copies) the video
      2. Writes all tags from the metadata JSON
      3. Strips encoder/handler/vendor fingerprints
    """
    cmd = ["ffmpeg", "-y", "-i", input_path]

    # Codec selection
    if copy_streams and not scale:
        cmd += ["-c", "copy"]
    else:
        # Match original codec params from the JSON where possible
        video_stream = next(
            (s for s in metadata.get("streams", []) if s.get("codec_type") == "video"), {}
        )
        audio_stream = next(
            (s for s in metadata.get("streams", []) if s.get("codec_type") == "audio"), {}
        )

        # Detect FPS for keyframe interval (GOP = fps * 2 → keyframe every 2s)
        fps = 30
        r_fps = video_stream.get("r_frame_rate", "")
        if r_fps and "/" in r_fps:
            try:
                num, den = r_fps.split("/")
                fps = round(int(num) / int(den))
            except (ValueError, ZeroDivisionError):
                pass
        gop = fps * 2  # keyframe every 2 seconds

        # Video codec
        v_codec = video_stream.get("codec_name", "h264")
        if v_codec in ("h264", "avc"):
            cmd += ["-c:v", "libx264", "-crf", "23", "-preset", "veryfast", "-tune", "fastdecode", "-bf", "0"]
            cmd += ["-g", str(gop), "-keyint_min", str(gop)]
            profile = video_stream.get("profile", "").lower()
            if profile in ("high", "main", "baseline"):
                cmd += ["-profile:v", profile]
            level = video_stream.get("level")
            if level:
                cmd += ["-level:v", f"{level / 10:.1f}"]
            pix_fmt = video_stream.get("pix_fmt")
            if pix_fmt:
                cmd += ["-pix_fmt", pix_fmt]
        elif v_codec in ("hevc", "h265"):
            cmd += ["-c:v", "libx265", "-crf", "20"]
            cmd += ["-x265-params", f"keyint={gop}:min-keyint={gop}"]
        else:
            cmd += ["-c:v", v_codec]

        # Scale filter
        if scale:
            w, h = scale.split("x")
            cmd += ["-vf", f"scale={w}:{h}"]

        # Audio codec
        a_codec = audio_stream.get("codec_name", "aac")
        a_bitrate = audio_stream.get("bit_rate")
        a_sample_rate = audio_stream.get("sample_rate")
        cmd += ["-c:a", a_codec]
        if a_bitrate:
            cmd += ["-b:a", f"{int(a_bitrate) // 1000}k"]
        if a_sample_rate:
            cmd += ["-ar", str(a_sample_rate)]

    # ── Metadata mapping ──────────────────────────────────────────────────

    # Start by copying all existing metadata from input
    cmd += ["-map_metadata", "0"]
    cmd += ["-map_metadata:s:v", "0:s:v"]
    cmd += ["-map_metadata:s:a", "0:s:a"]

    # Container-level tags from JSON
    fmt_tags = metadata.get("format", {}).get("tags", {})
    for key, value in fmt_tags.items():
        cmd += ["-metadata", f"{key}={value}"]

    # Video stream tags
    v_idx = 0
    for stream in metadata.get("streams", []):
        if stream.get("codec_type") == "video":
            stream_tags = stream.get("tags", {})
            for key, value in stream_tags.items():
                # Skip tags we'll explicitly blank below
                if key.lower() in ("encoder",):
                    continue
                cmd += [f"-metadata:s:v:{v_idx}", f"{key}={value}"]
            v_idx += 1

    # Audio stream tags
    a_idx = 0
    for stream in metadata.get("streams", []):
        if stream.get("codec_type") == "audio":
            stream_tags = stream.get("tags", {})
            for key, value in stream_tags.items():
                if key.lower() in ("encoder",):
                    continue
                cmd += [f"-metadata:s:a:{a_idx}", f"{key}={value}"]
            a_idx += 1

    # ── Strip encoder fingerprints ────────────────────────────────────────
    cmd += ["-metadata", "encoder="]
    cmd += ["-metadata:s:v", "encoder="]
    cmd += ["-metadata:s:a", "encoder="]
    cmd += ["-vendor", ""]
    cmd += ["-fflags", "+bitexact"]

    # Preserve rotation / display matrix + faststart for clean MP4 headers
    cmd += ["-movflags", "+faststart+use_metadata_tags"]

    cmd.append(output_path)
    return cmd


def preview_metadata(metadata: dict):
    """Show what metadata will be embedded."""
    fmt_tags = metadata.get("format", {}).get("tags", {})
    if fmt_tags:
        table = Table(title="Container Tags to Embed", border_style="cyan", show_lines=True)
        table.add_column("Tag", style="bold cyan", width=30)
        table.add_column("Value", style="white")
        for k, v in fmt_tags.items():
            table.add_row(k, str(v))
        console.print(table)

    for stream in metadata.get("streams", []):
        codec_type = stream.get("codec_type", "unknown").upper()
        idx = stream.get("index", "?")
        stream_tags = stream.get("tags", {})
        if stream_tags:
            table = Table(
                title=f"Stream #{idx} ({codec_type}) Tags to Embed",
                border_style="green", show_lines=True
            )
            table.add_column("Tag", style="bold green", width=30)
            table.add_column("Value", style="white")
            for k, v in stream_tags.items():
                table.add_row(k, str(v))
            console.print(table)


def verify_output(output_path: str):
    """Run ffprobe on the output and check for encoder leaks."""
    console.print(f"\n[bold cyan]🔍 Verifying output:[/] {output_path}")

    result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json",
         "-show_format", "-show_streams", output_path],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        console.print(f"[bold red]ffprobe failed on output: {result.stderr}[/]")
        return

    out_data = json.loads(result.stdout)

    # Check for encoder leaks
    leaks = []
    fmt_tags = out_data.get("format", {}).get("tags", {})
    for key in ("encoder",):
        val = fmt_tags.get(key, "")
        if val and ("lavf" in val.lower() or "lavc" in val.lower() or "ffmpeg" in val.lower()):
            leaks.append(f"format.tags.{key} = {val}")

    for stream in out_data.get("streams", []):
        idx = stream.get("index", "?")
        for key in ("encoder", "handler_name", "vendor_id"):
            val = stream.get("tags", {}).get(key, "")
            if val and ("lavf" in val.lower() or "lavc" in val.lower()
                        or "ffmpeg" in val.lower() or "handler" in val.lower()):
                leaks.append(f"stream[{idx}].tags.{key} = {val}")

    if leaks:
        console.print("[bold red]⚠️  Encoder fingerprints detected:[/]")
        for leak in leaks:
            console.print(f"  [red]• {leak}[/]")
    else:
        console.print("[bold green]✅ No encoder fingerprints found — clean output.[/]")

    # Show what ended up in the output
    table = Table(title="Output Container Tags", border_style="yellow", show_lines=True)
    table.add_column("Tag", style="bold yellow", width=30)
    table.add_column("Value", style="white")
    for k, v in fmt_tags.items():
        table.add_row(k, str(v))
    console.print(table)


# ── GUI Implementation ─────────────────────────────────────────────────────

class EmbedMetadataGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("NewsGenie Video Metadata Embedder")
        self.root.geometry("600x450")
        self.root.resizable(False, False)

        self.video_path_var = tk.StringVar()
        
        default_json = os.path.abspath("metadata.json")
        self.json_path_var = tk.StringVar(value=default_json if os.path.exists(default_json) else "")
        
        # Defaulting to 480p to prevent backend out-of-memory errors on large files
        self.quality_var = tk.StringVar(value="480p")
        self.output_path_var = tk.StringVar()
        self.progress_var = tk.DoubleVar()
        self.status_var = tk.StringVar(value="Ready")

        self.quality_var.trace_add("write", self.update_output_path)
        self.video_path_var.trace_add("write", self.update_output_path)

        self.build_ui()

    def build_ui(self):
        padding = {'padx': 15, 'pady': 10}
        
        # Video File Selection
        frame_video = tk.Frame(self.root)
        frame_video.pack(fill=tk.X, **padding)
        tk.Label(frame_video, text="Input Video:", width=15, anchor='w').pack(side=tk.LEFT)
        tk.Entry(frame_video, textvariable=self.video_path_var).pack(side=tk.LEFT, fill=tk.X, expand=True, padx=5)
        tk.Button(frame_video, text="Browse", command=self.browse_video).pack(side=tk.LEFT)

        # Metadata JSON Selection
        frame_json = tk.Frame(self.root)
        frame_json.pack(fill=tk.X, **padding)
        tk.Label(frame_json, text="Metadata JSON:", width=15, anchor='w').pack(side=tk.LEFT)
        tk.Entry(frame_json, textvariable=self.json_path_var).pack(side=tk.LEFT, fill=tk.X, expand=True, padx=5)
        tk.Button(frame_json, text="Browse", command=self.browse_json).pack(side=tk.LEFT)

        # Quality Selection
        frame_quality = tk.Frame(self.root)
        frame_quality.pack(fill=tk.X, **padding)
        tk.Label(frame_quality, text="Quality:", width=15, anchor='w').pack(side=tk.LEFT)
        qualities = ["Original (Copy)"] + list(RESOLUTION_PRESETS.keys())
        ttk.Combobox(frame_quality, textvariable=self.quality_var, values=qualities, state="readonly").pack(side=tk.LEFT)

        # Output Path Preview
        frame_out = tk.Frame(self.root)
        frame_out.pack(fill=tk.X, **padding)
        tk.Label(frame_out, text="Output Video:", width=15, anchor='w').pack(side=tk.LEFT)
        tk.Entry(frame_out, textvariable=self.output_path_var, state='readonly').pack(side=tk.LEFT, fill=tk.X, expand=True, padx=5)

        # Start Button
        self.start_btn = tk.Button(self.root, text="Start Encoding", command=self.start_encoding, bg="#4CAF50", fg="white", font=("Arial", 12, "bold"))
        self.start_btn.pack(pady=20, ipadx=20, ipady=5)

        # Progress Bar and Status
        self.progress_bar = ttk.Progressbar(self.root, variable=self.progress_var, maximum=100)
        self.progress_bar.pack(fill=tk.X, padx=20, pady=10)
        tk.Label(self.root, textvariable=self.status_var).pack()

    def browse_video(self):
        path = filedialog.askopenfilename(filetypes=[("Video Files", "*.mp4 *.mov *.avi *.mkv"), ("All Files", "*.*")])
        if path:
            self.video_path_var.set(path)
            
    def browse_json(self):
        path = filedialog.askopenfilename(filetypes=[("JSON Files", "*.json"), ("All Files", "*.*")])
        if path:
            self.json_path_var.set(path)

    def update_output_path(self, *args):
        video = self.video_path_var.get()
        if not video:
            self.output_path_var.set("")
            return
            
        qual = self.quality_var.get()
        p = Path(video)
        stem = p.stem
        
        if qual == "Original (Copy)":
            suffix = "_embedded"
        else:
            suffix = f"_{qual}"
            
        out_path = p.parent / f"{stem}{suffix}.mp4"
        self.output_path_var.set(str(out_path))

    def get_video_duration(self, filepath):
        try:
            cmd = ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", filepath]
            creation_flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
            proc = subprocess.run(cmd, capture_output=True, text=True, creationflags=creation_flags)
            if proc.returncode == 0:
                data = json.loads(proc.stdout)
                return float(data.get("format", {}).get("duration", 0))
        except Exception:
            pass
        return 0

    def start_encoding(self):
        input_vid = self.video_path_var.get()
        meta_json = self.json_path_var.get()
        out_vid = self.output_path_var.get()
        qual = self.quality_var.get()

        if not input_vid or not os.path.exists(input_vid):
            messagebox.showerror("Error", "Please select a valid input video.")
            return
        if not meta_json or not os.path.exists(meta_json):
            messagebox.showerror("Error", "Please select a valid metadata JSON.")
            return

        self.start_btn.config(state=tk.DISABLED)
        self.progress_var.set(0)
        self.status_var.set("Initializing...")

        threading.Thread(target=self.run_ffmpeg, args=(input_vid, meta_json, out_vid, qual), daemon=True).start()

    def run_ffmpeg(self, input_vid, meta_json, out_vid, qual):
        try:
            metadata = load_metadata(meta_json)
            scale = None
            copy_streams = True
            
            if qual != "Original (Copy)":
                scale = RESOLUTION_PRESETS[qual]
                copy_streams = False

            cmd = build_ffmpeg_cmd(input_vid, out_vid, metadata, copy_streams=copy_streams, scale=scale)
            
            cmd.insert(-1, "-progress")
            cmd.insert(-1, "-")
            cmd.insert(-1, "-nostats")

            duration = self.get_video_duration(input_vid)
            
            self.root.after(0, self.status_var.set, "Encoding...")
            
            creation_flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1, creationflags=creation_flags)

            log_output = []
            for line in proc.stdout:
                log_output.append(line)
                if len(log_output) > 100:
                    log_output.pop(0)
                
                if "out_time_us=" in line:
                    try:
                        time_us = int(line.split("=")[1].strip())
                        if duration > 0:
                            perc = (time_us / 1_000_000) / duration * 100
                            self.root.after(0, self.progress_var.set, min(99.9, perc))
                    except ValueError:
                        pass
                elif "progress=end" in line:
                    self.root.after(0, self.progress_var.set, 100)

            proc.wait()
            
            if proc.returncode == 0:
                self.root.after(0, self.status_var.set, "Completed successfully!")
                self.root.after(0, self.progress_var.set, 100)
                try:
                    verify_output(out_vid)
                except Exception:
                    pass
                self.root.after(0, messagebox.showinfo, "Success", f"Video saved to:\n{out_vid}")
            else:
                err = "".join(log_output)
                self.root.after(0, self.status_var.set, "Error occurred")
                self.root.after(0, messagebox.showerror, "FFmpeg Error", err[:1000])

        except Exception as e:
            self.root.after(0, self.status_var.set, "Error occurred")
            self.root.after(0, messagebox.showerror, "Error", str(e))
        finally:
            self.root.after(0, lambda: self.start_btn.config(state=tk.NORMAL))


def main_gui():
    root = tk.Tk()
    app = EmbedMetadataGUI(root)
    root.mainloop()

# ── Entry point ────────────────────────────────────────────────────────────
if __name__ == "__main__":
    if len(sys.argv) > 1:
        parser = argparse.ArgumentParser(description="Embed metadata into a video file.")
        parser.add_argument("input_video", help="Path to input video")
        parser.add_argument("metadata_json", help="Path to metadata JSON")
        parser.add_argument("-o", "--output", default=None, dest="output_video", help="Path to output video")
        parser.add_argument("--scale", default=None,
                            help=f"Resolution: WxH or preset ({', '.join(RESOLUTION_PRESETS)})")
        args = parser.parse_args()

        if args.scale and args.scale.lower() in RESOLUTION_PRESETS:
            args.scale = RESOLUTION_PRESETS[args.scale.lower()]

        if not os.path.exists(args.input_video):
            console.print(f"[bold red]❌ Input video not found: {args.input_video}[/]")
            sys.exit(1)
        if not os.path.exists(args.metadata_json):
            console.print(f"[bold red]❌ Metadata JSON not found: {args.metadata_json}[/]")
            sys.exit(1)

        output_video = args.output_video
        if not output_video:
            stem = Path(args.input_video).stem
            output_video = str(Path(args.input_video).parent / f"{stem}_embedded.mp4")

        metadata = load_metadata(args.metadata_json)

        console.print(Panel("[bold]Metadata to embed[/]", border_style="cyan"))
        preview_metadata(metadata)

        cmd = build_ffmpeg_cmd(args.input_video, output_video, metadata,
                               copy_streams=False, scale=args.scale)

        console.print(f"\n[bold cyan]🎬 FFmpeg command:[/]")
        console.print(" ".join(cmd))
        console.print()

        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            console.print(f"[bold red]❌ FFmpeg failed:[/]\n{proc.stderr}")
            sys.exit(1)

        console.print(f"[bold green]✅ Output written to:[/] {output_video}")
        verify_output(output_video)
    else:
        main_gui()
