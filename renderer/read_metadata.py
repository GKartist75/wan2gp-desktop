"""Read generation metadata embedded in media files.

Supports:
- PNG: tEXt/zTXt chunks (parameters, comment, Description, etc.)
- JPG/JPEG: EXIF UserComment (piexif) + PNG-style comment chunk
- WebP: EXIF UserComment via piexif
- MP4/MKV/MOV: uuid user data / com.apple.quicktime.userdata
- GIF: comment extension blocks
- BMP/ TIFF: standard metadata
- Audio files (MP3, WAV, FLAC, OGG): ID3/WAV comments

Does NOT require the full Wan2GP environment — only Pillow + piexif.
"""

import sys
import json
import struct
import os

# ── Helpers ──

def _try_parse_json(val):
    """Try to parse a value as JSON, return (parsed, True) or (value, False)."""
    if not val:
        return val, False
    # Strip null bytes
    if isinstance(val, bytes):
        val = val.decode('utf-8', errors='replace').strip('\x00').strip()
    s = str(val).strip()
    if s.startswith('{') or s.startswith('['):
        try:
            return json.loads(s), True
        except (json.JSONDecodeError, ValueError):
            pass
    return val, False


def _merge(result, parsed):
    """Merge parsed JSON into result dict."""
    if isinstance(parsed, dict):
        for k, v in parsed.items():
            if k not in result or result[k] is None:
                result[k] = v


# ── PNG reader ──

def _read_png(path):
    """Read PNG tEXt/zTXt chunks and return metadata dict."""
    result = {}
    try:
        from PIL import Image
        with Image.open(path) as im:
            text = getattr(im, 'text', {}) or im.info or {}
            for key in ('parameters', 'comment', 'Description', 'prompt', 'settings'):
                val = text.get(key)
                if val:
                    parsed, is_json = _try_parse_json(val)
                    if is_json:
                        _merge(result, parsed)
                    else:
                        result.setdefault('prompt', val)
                    result.setdefault('_raw_comment', val)
            # Also store full text dict
            if text:
                for k, v in text.items():
                    if k not in ('parameters', 'comment', 'Description') and v:
                        result[f'_{k}'] = v
    except ImportError:
        # No Pillow — try raw chunk reading
        result.update(_read_png_raw(path))
    return result


def _read_png_raw(path):
    """Minimal PNG iTXt/tEXt/zTXt reader without PIL."""
    result = {}
    try:
        with open(path, 'rb') as f:
            sig = f.read(8)
            if sig[1:4] != b'PNG':
                return {}
            while True:
                hdr = f.read(8)
                if len(hdr) < 8:
                    break
                length = struct.unpack('>I', hdr[:4])[0]
                ctype = hdr[4:8]
                if ctype == b'IEND':
                    break
                if ctype in (b'tEXt', b'zTXt', b'iTXt') and length > 0:
                    data = f.read(length)
                    null_idx = data.find(b'\x00')
                    if null_idx < 0:
                        f.read(4)  # CRC
                        continue
                    keyword = data[:null_idx].decode('latin1', errors='replace')
                    if keyword not in ('comment', 'Description', 'parameters'):
                        f.read(4)  # CRC
                        continue
                    text_start = null_idx + 1
                    if ctype == b'iTXt':
                        text_start = null_idx + 1 + 2  # skip flag + method
                        lang_end = data.find(b'\x00', text_start)
                        if lang_end < 0:
                            f.read(4); continue
                        text_start = lang_end + 1
                        trans_end = data.find(b'\x00', text_start)
                        if trans_end < 0:
                            f.read(4); continue
                        text_start = trans_end + 1
                        val = data[text_start:].decode('utf-8', errors='replace')
                    elif ctype == b'zTXt':
                        text_start = null_idx + 1 + 1  # skip compression method
                        import zlib
                        val = zlib.decompress(data[text_start:]).decode('utf-8', errors='replace')
                    else:  # tEXt
                        val = data[text_start:].decode('latin1', errors='replace')
                    parsed, is_json = _try_parse_json(val)
                    if is_json:
                        _merge(result, parsed)
                    else:
                        result.setdefault('prompt', val)
                    result.setdefault('_raw_comment', val)
                else:
                    f.read(length)
                # CRC
                f.read(4)
    except Exception:
        pass
    return result


# ── JPEG reader ──

def _read_jpeg(path):
    """Read JPEG EXIF UserComment and return metadata dict."""
    result = {}
    try:
        from PIL import Image
        with Image.open(path) as im:
            exif = getattr(im, 'getexif', lambda: None)()
            if exif:
                uc = exif.get(37510)  # UserComment
                if uc:
                    # Handle various encodings
                    if isinstance(uc, bytes):
                        s = uc.decode('utf-8', errors='replace').strip('\x00').strip()
                    else:
                        s = str(uc).strip()
                    parsed, is_json = _try_parse_json(s)
                    if is_json:
                        _merge(result, parsed)
                    elif s:
                        result.setdefault('prompt', s)
                    result.setdefault('_raw_comment', s)
            # Also check text/comment in info
            val = im.info.get('comment')
            if val:
                if isinstance(val, bytes):
                    val = val.decode('utf-8', errors='replace')
                parsed, is_json = _try_parse_json(val)
                if is_json:
                    _merge(result, parsed)
    except ImportError:
        pass
    # Try piexif as fallback
    try:
        import piexif
        exif_dict = piexif.load(path)
        uc = exif_dict.get('Exif', {}).get(piexif.ExifIFD.UserComment)
        if uc:
            s = uc.decode('utf-8', errors='replace').strip('\x00').strip()
            parsed, is_json = _try_parse_json(s)
            if is_json:
                _merge(result, parsed)
            elif s and 'prompt' not in result:
                result['prompt'] = s
            result.setdefault('_raw_comment', s)
    except Exception:
        pass
    return result


# ── WebP reader ──

def _read_webp(path):
    """Read WebP EXIF UserComment."""
    result = {}
    try:
        import piexif
        exif_bytes = None
        from PIL import Image
        with Image.open(path) as im:
            exif_bytes = im.info.get('exif')
        if exif_bytes:
            exif_dict = piexif.load(exif_bytes)
            uc = exif_dict.get('Exif', {}).get(piexif.ExifIFD.UserComment)
            if uc:
                s = uc.decode('utf-8', errors='replace').strip('\x00').strip()
                parsed, is_json = _try_parse_json(s)
                if is_json:
                    _merge(result, parsed)
                elif s:
                    result.setdefault('prompt', s)
                result.setdefault('_raw_comment', s)
    except Exception:
        pass
    return result


# ── Video reader (MP4/MKV/MOV) ──

def _read_video(path):
    """Read embedded metadata from video files."""
    result = {}
    ext = os.path.splitext(path)[1].lower()

    # Try ffprobe first
    import subprocess
    try:
        cmd = ['ffprobe', '-v', 'quiet', '-print_format', 'json',
               '-show_format', path]
        out = subprocess.check_output(cmd, timeout=10, stderr=subprocess.DEVNULL)
        data = json.loads(out)
        fmt = data.get('format', {})
        tags = fmt.get('tags', {})
        for key in ('comment', 'description', 'prompt', 'settings', 'title'):
            val = tags.get(key)
            if val:
                parsed, is_json = _try_parse_json(val)
                if is_json:
                    _merge(result, parsed)
                else:
                    result.setdefault('prompt', val)
                result.setdefault('_raw_comment', val)
        # Also check for Wan2GP-specific keys
        for k, v in tags.items():
            if k.lower() in ('wangp-settings', 'wangp_settings', 'generation_params',
                             'generation-params'):
                parsed, is_json = _try_parse_json(v)
                if is_json:
                    _merge(result, parsed)
        if tags:
            # Store all tags prefixed
            for k, v in tags.items():
                if isinstance(v, str) and len(v) > 4 and k not in result:
                    parsed, is_json = _try_parse_json(v)
                    if is_json:
                        _merge(result, parsed)
    except (FileNotFoundError, subprocess.TimeoutExpired, json.JSONDecodeError):
        pass

    # If ffprobe failed, try raw parsing for MP4
    if not result and ext == '.mp4':
        result.update(_read_mp4_raw(path))

    return result


def _read_mp4_raw(path):
    """Minimal MP4 metadata reader — reads 'uuid' boxes with Wan2GP data."""
    result = {}
    try:
        with open(path, 'rb') as f:
            while True:
                hdr = f.read(8)
                if len(hdr) < 8:
                    break
                box_size = struct.unpack('>I', hdr[:4])[0]
                box_type = hdr[4:8]
                if box_size < 8:
                    break
                data_size = box_size - 8
                if data_size > 1000000 or data_size < 0:
                    break
                if box_type == b'uuid':
                    data = f.read(data_size) if data_size else b''
                    # Check for Wan2GP UUID
                    if data[:16] in _WAN2GP_UUIDS:
                        try:
                            meta_str = data[16:].decode('utf-8', errors='replace').strip('\x00').strip()
                            parsed, is_json = _try_parse_json(meta_str)
                            if is_json:
                                _merge(result, parsed)
                            elif meta_str:
                                result.setdefault('prompt', meta_str)
                            result.setdefault('_raw_comment', meta_str)
                        except Exception:
                            pass
                elif box_type == b'moov' or box_type == b'udta' or box_type == b'meta':
                    # Recurse into container boxes
                    sub_data = f.read(data_size) if data_size else b''
                    _ = sub_data  # Could recursively parse
                else:
                    if data_size > 0:
                        f.read(data_size)
    except Exception:
        pass
    return result


# Wan2GP UUIDs for MP4 metadata boxes (placeholders — adjust based on actual usage)
_WAN2GP_UUIDS = [
    b'\x00' * 16,  # Replace with actual UUID
]


# ── GIF reader ──

def _read_gif(path):
    """Read GIF comment extension blocks."""
    result = {}
    try:
        from PIL import Image
        with Image.open(path) as im:
            # GIF stores comments in info dict via iterating frames
            for frame in range(getattr(im, 'n_frames', 1)):
                try:
                    im.seek(frame)
                except Exception:
                    break
                comment = im.info.get('comment') or im.info.get('description')
                if comment:
                    if isinstance(comment, bytes):
                        comment = comment.decode('utf-8', errors='replace')
                    parsed, is_json = _try_parse_json(comment)
                    if is_json:
                        _merge(result, parsed)
                    else:
                        result.setdefault('prompt', comment)
                    result.setdefault('_raw_comment', comment)
                    break  # First frame comment is enough
    except Exception:
        pass
    return result


# ── Audio reader ──

def _read_audio(path):
    """Read metadata from audio files."""
    result = {}
    # Try ffprobe
    import subprocess
    try:
        cmd = ['ffprobe', '-v', 'quiet', '-print_format', 'json',
               '-show_format', path]
        out = subprocess.check_output(cmd, timeout=10, stderr=subprocess.DEVNULL)
        data = json.loads(out)
        tags = data.get('format', {}).get('tags', {})
        for key in ('comment', 'description', 'prompt', 'settings', 'title'):
            val = tags.get(key)
            if val:
                parsed, is_json = _try_parse_json(val)
                if is_json:
                    _merge(result, parsed)
                else:
                    result.setdefault('prompt', val)
                result.setdefault('_raw_comment', val)
    except Exception:
        pass

    # Try mutagen for ID3
    try:
        from mutagen.easyid3 import EasyID3
        audio = EasyID3(path)
        for key in ('comment', 'description'):
            val = audio.get(key, [''])[0]
            if val:
                result.setdefault('prompt', val)
                result.setdefault('_raw_comment', val)
    except Exception:
        pass

    # Try mutagen for generic tags
    try:
        from mutagen import File
        mf = File(path)
        if mf is not None:
            for key in ('COMMENT', 'comment', 'DESCRIPTION', 'description'):
                val = mf.get(key)
                if val:
                    if isinstance(val, list):
                        val = val[0] if val else ''
                    if isinstance(val, bytes):
                        val = val.decode('utf-8', errors='replace')
                    result.setdefault('prompt', str(val))
                    result.setdefault('_raw_comment', str(val))
    except Exception:
        pass

    return result


# ── Generic sidecar reader ──

def _read_sidecar(path):
    """Check for .json or .txt sidecar files."""
    result = {}
    for ext in ['.json', '.txt']:
        sidecar = path + ext
        if os.path.exists(sidecar):
            try:
                with open(sidecar, 'r', encoding='utf-8') as f:
                    content = f.read()
                if ext == '.json':
                    parsed = json.loads(content)
                    if isinstance(parsed, dict):
                        _merge(result, parsed)
                        result['_raw_comment'] = json.dumps(parsed)
                    elif isinstance(parsed, str):
                        result['prompt'] = parsed
                        result['_raw_comment'] = parsed
                else:
                    result['prompt'] = content.strip()
                    result['_raw_comment'] = content.strip()
            except Exception:
                pass
    return result


# ── Main dispatcher ──

def read_metadata(path):
    """Read embedded generation metadata from any file type."""
    # First check sidecar files (fastest, most reliable)
    result = _read_sidecar(path)
    if result:
        return result

    ext = os.path.splitext(path)[1].lower()

    if ext == '.png':
        result = _read_png(path)
    elif ext in ('.jpg', '.jpeg'):
        result = _read_jpeg(path)
    elif ext == '.webp':
        result = _read_webp(path)
    elif ext in ('.gif',):
        result = _read_gif(path)
    elif ext in ('.mp4', '.mkv', '.mov', '.avi', '.webm'):
        result = _read_video(path)
    elif ext in ('.mp3', '.wav', '.flac', '.ogg', '.m4a', '.wma'):
        result = _read_audio(path)
    elif ext in ('.bmp', '.tiff', '.tif'):
        try:
            from PIL import Image
            with Image.open(path) as im:
                for val in im.info.values():
                    if isinstance(val, str) and len(val) > 10:
                        parsed, is_json = _try_parse_json(val)
                        if is_json:
                            _merge(result, parsed)
                        break
        except Exception:
            pass
    elif ext in ('.json',):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                content = json.load(f)
            if isinstance(content, dict):
                _merge(result, content)
                result['_raw_comment'] = json.dumps(content)
            elif isinstance(content, str):
                result['prompt'] = content
        except Exception:
            pass
    elif ext in ('.txt',):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                result['prompt'] = f.read().strip()
        except Exception:
            pass

    return result


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: read_metadata.py <file_path>"}))
        sys.exit(1)

    file_path = sys.argv[1]
    if not os.path.exists(file_path):
        print(json.dumps({"error": f"File not found: {file_path}"}))
        sys.exit(1)

    try:
        meta = read_metadata(file_path)
        if meta:
            # Clean up: remove empty/null values
            meta = {k: v for k, v in meta.items() if v is not None and v != ''}
            print('META_OK:' + json.dumps(meta, default=str))
        else:
            print('META_NULL')
    except Exception as e:
        print(json.dumps({"error": str(e)}))


if __name__ == '__main__':
    main()
