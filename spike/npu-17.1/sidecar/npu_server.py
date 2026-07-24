# Banc d'essai : sidecar NPU (Hexagon/QNN) exposant un endpoint OpenAI-compatible
# streamé, pour tester le copilote de Doku sur NPU. PAS la forme livrable finale
# (ce serait des bindings Rust) — c'est pour JUGER l'experience NPU vs CPU dans l'app.
import os, sys, json, threading, time
import onnxruntime_qnn as oq

LIB = os.path.dirname(oq.get_qnn_htp_path())
os.add_dll_directory(LIB)
os.environ["PATH"] = LIB + os.pathsep + os.environ.get("PATH", "")
os.environ["ADSP_LIBRARY_PATH"] = LIB

import onnxruntime_genai as og
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL_DIR = os.environ.get("NPU_MODEL", r"C:/Users/nicos/.foundry/cache/models/Microsoft/qwen2.5-1.5b-instruct-qnn-npu-3/v3")
PORT = int(os.environ.get("NPU_PORT", "8017"))
MODEL_NAME = "qwen2.5-1.5b-npu"

print(f"[npu] chargement {MODEL_DIR} sur Hexagon/QNN…", flush=True)
og.register_execution_provider_library("QNNExecutionProvider", oq.get_library_path())
_cfg = og.Config(MODEL_DIR); _cfg.clear_providers(); _cfg.append_provider("QNNExecutionProvider")
_model = og.Model(_cfg)
_tok = og.Tokenizer(_model)
_lock = threading.Lock()   # genai n'est pas thread-safe : on sérialise
print(f"[npu] prêt sur http://127.0.0.1:{PORT}/v1 (modèle {MODEL_NAME})", flush=True)

def build_prompt(messages):
    # Template Qwen2.5 (chatml)
    parts = []
    for m in messages:
        role = m.get("role", "user"); content = m.get("content", "")
        parts.append(f"<|im_start|>{role}\n{content}<|im_end|>\n")
    parts.append("<|im_start|>assistant\n")
    return "".join(parts)

def sse(obj):
    return ("data: " + json.dumps(obj, ensure_ascii=False) + "\n\n").encode("utf-8")

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()
    def do_GET(self):
        if self.path.rstrip("/") == "/v1/models":
            self.send_response(200); self.send_header("Content-Type","application/json"); self._cors(); self.end_headers()
            self.wfile.write(json.dumps({"object":"list","data":[{"id":MODEL_NAME,"object":"model"}]}).encode())
        else:
            self.send_response(404); self.end_headers()
    def do_POST(self):
        if self.path.rstrip("/") != "/v1/chat/completions":
            self.send_response(404); self.end_headers(); return
        n = int(self.headers.get("Content-Length", "0"))
        req = json.loads(self.rfile.read(n) or "{}")
        messages = req.get("messages", [])
        max_new = int(req.get("max_tokens") or 512)
        stream = bool(req.get("stream"))
        prompt = build_prompt(messages)
        ids = _tok.encode(prompt)
        maxlen = max(128, len(ids) + max_new)
        self.send_response(200); self._cors()
        if stream:
            self.send_header("Content-Type","text/event-stream"); self.end_headers()
        else:
            self.send_header("Content-Type","application/json"); self.end_headers()
        created = int(time.time()); cid = f"chatcmpl-npu-{created}"
        text_all = []
        with _lock:
            p = og.GeneratorParams(_model)
            # Anti-boucle : un 1.5B en greedy sans penalite deraille ("prepre...").
            # repetition_penalty + echantillonnage doux (comme les defauts d'Ollama).
            try:
                p.set_search_options(max_length=maxlen, do_sample=True, temperature=0.3,
                                     top_p=0.9, top_k=40, repetition_penalty=1.15)
            except Exception:
                # Certains graphes QNN ne supportent que le greedy : au moins la penalite.
                p.set_search_options(max_length=maxlen, do_sample=False, repetition_penalty=1.15)
            g = og.Generator(_model, p)
            g.append_tokens(ids)
            ts = _tok.create_stream()
            first = True
            try:
                while not g.is_done():
                    g.generate_next_token()
                    t = g.get_next_tokens()[0]
                    piece = ts.decode(t)
                    if not piece: continue
                    text_all.append(piece)
                    if stream:
                        delta = {"role":"assistant","content":piece} if first else {"content":piece}
                        first = False
                        self.wfile.write(sse({"id":cid,"object":"chat.completion.chunk","created":created,
                            "model":MODEL_NAME,"choices":[{"index":0,"delta":delta,"finish_reason":None}]}))
                        self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                return
        if stream:
            self.wfile.write(sse({"id":cid,"object":"chat.completion.chunk","created":created,
                "model":MODEL_NAME,"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}))
            self.wfile.write(b"data: [DONE]\n\n"); self.wfile.flush()
        else:
            body = {"id":cid,"object":"chat.completion","created":created,"model":MODEL_NAME,
                "choices":[{"index":0,"message":{"role":"assistant","content":"".join(text_all)},"finish_reason":"stop"}]}
            self.wfile.write(json.dumps(body, ensure_ascii=False).encode("utf-8"))

ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
