import queue
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.request import urlretrieve


@dataclass
class WakewordStatus:
    enabled: bool
    ready: bool
    keyword: str
    backend: str
    error: str
    last_score: float
    peak_score: float


class WakewordService:
    def __init__(self, *, enabled: bool, threshold: float, cooldown_s: float, keyword_name: str, keyword_model: str):
        self._enabled = bool(enabled)
        self._threshold = float(threshold)
        self._cooldown_s = float(cooldown_s)
        self._keyword_name = (keyword_name or "").strip().lower()
        self._keyword_model = (keyword_model or "").strip()
        self._ready = False
        self._error = ""
        self._keyword = ""
        self._backend = "disabled"
        self._last_score = 0.0
        self._peak_score = 0.0

        self._events: "queue.Queue[float]" = queue.Queue()
        self._stop = threading.Event()
        self._thread = None
        self._last_trigger_at = 0.0

    def start(self):
        if not self._enabled:
            self._backend = "disabled"
            return
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="wakeword-listener", daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=1.5)

    def status(self) -> WakewordStatus:
        return WakewordStatus(
            enabled=self._enabled,
            ready=self._ready,
            keyword=self._keyword,
            backend=self._backend,
            error=self._error,
            last_score=self._last_score,
            peak_score=self._peak_score,
        )

    def consume(self) -> bool:
        try:
            self._events.get_nowait()
            return True
        except queue.Empty:
            return False

    def _emit_trigger(self):
        now = time.time()
        if now - self._last_trigger_at < self._cooldown_s:
            return
        self._last_trigger_at = now
        self._events.put(now)

    def _run(self):
        try:
            import numpy as np
            import sounddevice as sd
            import openwakeword
            from openwakeword.model import Model
        except Exception as exc:
            self._ready = False
            self._error = f"openwakeword deps not available: {exc}"
            self._backend = "unavailable"
            return

        try:
            self._ensure_openwakeword_models(openwakeword)
            if self._keyword_model:
                model = Model(wakeword_models=[self._keyword_model], inference_framework="onnx")
                self._keyword = self._keyword_model
            else:
                requested_name = self._keyword_name or "alexa"
                model = Model(wakeword_models=[requested_name], inference_framework="onnx")
                names = list(getattr(model, "models", {}).keys())
                lower_name_map = {str(name).lower(): name for name in names}
                self._keyword = lower_name_map.get(self._keyword_name) or (names[0] if names else "default")
                if self._keyword_name and self._keyword_name not in lower_name_map and names:
                    self._error = f"keyword '{self._keyword_name}' not found, using '{self._keyword}'"
            self._backend = "openwakeword"
            self._ready = True
        except Exception as exc:
            self._ready = False
            self._error = f"openwakeword init failed: {exc}"
            self._backend = "init_failed"
            return

        sample_rate = 16000
        blocksize = 1280

        def on_audio(indata, frames, _time_info, status):
            if self._stop.is_set():
                return
            if status:
                return
            try:
                # sounddevice delivers float32 [-1, 1]; openwakeword expects int16 PCM.
                audio = np.array(indata[:, 0], dtype=np.float32)
                audio = np.clip(audio, -1.0, 1.0)
                audio = (audio * 32767.0).astype(np.int16)
                scores = model.predict(audio)
                score = 0.0
                if isinstance(scores, dict):
                    score = float(scores.get(self._keyword, 0.0))
                    if score <= 0.0 and scores:
                        score = float(max(scores.values()))
                elif isinstance(scores, (int, float)):
                    score = float(scores)
                self._last_score = score
                if score > self._peak_score:
                    self._peak_score = score
                if score >= self._threshold:
                    self._emit_trigger()
            except Exception:
                return

        try:
            with sd.InputStream(
                channels=1,
                samplerate=sample_rate,
                blocksize=blocksize,
                dtype="float32",
                callback=on_audio,
            ):
                while not self._stop.is_set():
                    time.sleep(0.1)
        except Exception as exc:
            self._ready = False
            self._error = f"audio stream failed: {exc}"
            self._backend = "stream_failed"

    def _ensure_openwakeword_models(self, openwakeword_module):
        pkg_dir = Path(openwakeword_module.__file__).resolve().parent
        models_dir = pkg_dir / "resources" / "models"
        models_dir.mkdir(parents=True, exist_ok=True)

        base_url = "https://github.com/dscripka/openWakeWord/releases/download/v0.5.1"
        required = ["embedding_model.onnx", "melspectrogram.onnx"]

        if self._keyword_model:
            required.append(Path(self._keyword_model).name)
        else:
            keyword_file = f"{self._keyword_name}_v0.1.onnx" if self._keyword_name else ""
            if keyword_file:
                required.append(keyword_file)

        for filename in required:
            target = models_dir / filename
            if target.exists():
                continue
            url = f"{base_url}/{filename}"
            try:
                urlretrieve(url, str(target))
            except Exception as exc:
                raise RuntimeError(f"failed downloading {filename} from {url}: {exc}") from exc
