import queue
import shutil
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.request import urlretrieve

from . import config


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
        self._score_key_fixed = False

        self._events: "queue.Queue[float]" = queue.Queue()
        self._stop = threading.Event()
        self._thread = None
        self._last_trigger_at = 0.0

    def _assets_wakeword_dir(self) -> Path:
        return (config.ROOT_DIR / "assets" / "wakeword").resolve()

    def _resolve_explicit_model_path(self) -> Path | None:
        raw = (self._keyword_model or "").strip()
        if not raw:
            return None
        path = Path(raw)
        if not path.is_absolute():
            path = (config.ROOT_DIR / path).resolve()
        if not path.is_file():
            raise FileNotFoundError(f"wakeword model not found: {path}")
        return path

    def _resolve_assets_keyword_path(self) -> Path | None:
        if (self._keyword_model or "").strip():
            return None
        name = (self._keyword_name or "alexa").strip().lower()
        if not name:
            return None
        assets = self._assets_wakeword_dir()
        for suffix in (f"{name}_v0.1.onnx", f"{name}.onnx"):
            candidate = (assets / suffix).resolve()
            if candidate.is_file():
                return candidate
        return None

    def _resolve_wakeword_onnx_source(self) -> Path | None:
        explicit = self._resolve_explicit_model_path()
        if explicit:
            return explicit
        return self._resolve_assets_keyword_path()

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

    def _maybe_fix_score_key(self, scores: dict) -> None:
        if self._score_key_fixed or not scores:
            return
        if self._keyword in scores:
            self._score_key_fixed = True
            return
        if len(scores) == 1:
            self._keyword = next(iter(scores))
            self._score_key_fixed = True
            return
        stem = Path(self._keyword).stem.lower() if self._keyword else ""
        for key in scores:
            if str(key).lower() == stem or (stem and stem in str(key).lower()):
                self._keyword = key
                self._score_key_fixed = True
                return

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
            onnx_src = self._resolve_wakeword_onnx_source()
            model_onnx_path = self._ensure_openwakeword_models(openwakeword, onnx_src)
            model = Model(wakeword_models=[str(model_onnx_path)], inference_framework="onnx")
            names = list(getattr(model, "models", {}).keys())
            self._keyword = names[0] if names else model_onnx_path.stem
            if not onnx_src and self._keyword_name:
                lower_name_map = {str(name).lower(): name for name in names}
                if self._keyword_name in lower_name_map:
                    self._keyword = lower_name_map[self._keyword_name]
                elif self._keyword_name not in lower_name_map and names:
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
                audio = np.array(indata[:, 0], dtype=np.float32)
                audio = np.clip(audio, -1.0, 1.0)
                audio = (audio * 32767.0).astype(np.int16)
                scores = model.predict(audio)
                score = 0.0
                if isinstance(scores, dict):
                    self._maybe_fix_score_key(scores)
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

    def _ensure_openwakeword_models(self, openwakeword_module, onnx_src: Path | None) -> Path | None:
        pkg_dir = Path(openwakeword_module.__file__).resolve().parent
        models_dir = pkg_dir / "resources" / "models"
        models_dir.mkdir(parents=True, exist_ok=True)
        assets_dir = self._assets_wakeword_dir()
        assets_dir.mkdir(parents=True, exist_ok=True)

        base_url = "https://github.com/dscripka/openWakeWord/releases/download/v0.5.1"
        for filename in ["embedding_model.onnx", "melspectrogram.onnx"]:
            target = models_dir / filename
            if target.exists():
                continue
            url = f"{base_url}/{filename}"
            try:
                urlretrieve(url, str(target))
            except Exception as exc:
                raise RuntimeError(f"failed downloading {filename} from {url}: {exc}") from exc

        if onnx_src:
            dest = models_dir / onnx_src.name
            shutil.copy2(onnx_src, dest)
            return dest

        keyword_file = f"{self._keyword_name or 'alexa'}_v0.1.onnx"
        asset_path = assets_dir / keyword_file
        if not asset_path.is_file():
            url = f"{base_url}/{keyword_file}"
            try:
                urlretrieve(url, str(asset_path))
            except Exception as exc:
                raise RuntimeError(
                    f"failed downloading {keyword_file} from {url}: {exc}. "
                    f"Coloca el onnx en {asset_path} o define WAKEWORD_MODEL_PATH."
                ) from exc
        dest = models_dir / keyword_file
        shutil.copy2(asset_path, dest)
        return dest


def run_diagnostics() -> dict:
    try:
        import numpy as np
        import onnxruntime as ort
        import openwakeword
        from openwakeword.model import Model
    except Exception as exc:
        return {"ok": False, "error": str(exc)}

    svc = WakewordService(
        enabled=True,
        threshold=config.WAKEWORD_THRESHOLD,
        cooldown_s=config.WAKEWORD_COOLDOWN_S,
        keyword_name=config.WAKEWORD_NAME,
        keyword_model=config.WAKEWORD_MODEL_PATH,
    )
    out: dict = {
        "ok": True,
        "keyword_name_config": config.WAKEWORD_NAME,
        "model_path_config": config.WAKEWORD_MODEL_PATH or None,
        "threshold_config": config.WAKEWORD_THRESHOLD,
    }
    try:
        onnx_src = svc._resolve_wakeword_onnx_source()
        model_path = svc._ensure_openwakeword_models(openwakeword, onnx_src)
    except Exception as exc:
        return {**out, "ok": False, "error": str(exc), "phase": "resolve_or_ensure"}

    out["resolved_source"] = str(onnx_src) if onnx_src else None
    out["loaded_path"] = str(model_path)

    try:
        sess = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
        inp = sess.get_inputs()[0]
        outp = sess.get_outputs()[0]
        def _shape(s):
            return [int(x) if isinstance(x, (int, float)) else str(x) for x in s]

        out["onnx_input"] = {"name": inp.name, "shape": _shape(inp.shape), "type": str(inp.type)}
        out["onnx_output"] = {"name": outp.name, "shape": _shape(outp.shape), "type": str(outp.type)}
    except Exception as exc:
        out["onnx_session_error"] = str(exc)

    try:
        model = Model(wakeword_models=[str(model_path)], inference_framework="onnx")
        keys = list(model.models.keys())
        out["openwakeword_model_keys"] = keys
        out["openwakeword_input_frames"] = {k: int(model.model_inputs[k]) for k in keys}
        out["openwakeword_output_dim"] = {k: int(model.model_outputs[k]) for k in keys}
    except Exception as exc:
        return {**out, "ok": False, "openwakeword_init_error": str(exc)}

    silence = np.zeros(1280, dtype=np.int16)
    rng = np.random.default_rng(0)
    max_silence = 0.0
    max_noise = 0.0
    for _ in range(80):
        scores = model.predict(silence)
        if isinstance(scores, dict) and scores:
            max_silence = max(max_silence, float(max(scores.values())))
    for _ in range(80):
        noise = rng.integers(-3000, 3000, size=1280, dtype=np.int16)
        scores = model.predict(noise)
        if isinstance(scores, dict) and scores:
            max_noise = max(max_noise, float(max(scores.values())))

    out["synthetic_max_score_after_warmup_silence"] = max_silence
    out["synthetic_max_score_after_warmup_noise"] = max_noise
    out["interpretation"] = (
        "Si ambos maximos son casi 0, el ONNX probablemente no es un clasificador openwakeword valido "
        "(entrada debe ser embeddings del melspec+embedding del paquete). "
        "Si hay score con ruido pero no te dispara al hablar, baja WAKEWORD_THRESHOLD o revisa microfono."
    )
    return out
