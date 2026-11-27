# Voie NPU : le decoder ONNX officiel de LFM3-Omni peut-il tourner sur le HTP Hexagon ?
# Recette npu-17.1 (onnxruntime-qnn en EP plugin + ADSP_LIBRARY_PATH), sans onnxruntime-genai :
# le repo ONNX n'a pas de genai_config.json, genai ne sait pas le charger.
# Essai 1 : HTP SANS repli CPU (verdict net). Essai 2 : repli autorisé, logs verbeux
# (combien de nœuds le QNN EP accepte réellement).
# Usage : <python ARM64> -I qnn-probe.py <decoder.onnx>
import os, sys
import onnxruntime_qnn as oq
LIB = os.path.dirname(oq.get_qnn_htp_path())
os.add_dll_directory(LIB)
os.environ["PATH"] = LIB + os.pathsep + os.environ.get("PATH", "")
os.environ["ADSP_LIBRARY_PATH"] = LIB
import onnxruntime as ort

model = sys.argv[1]
ort.register_execution_provider_library("QNNExecutionProvider", oq.get_library_path())
npu = [d for d in ort.get_ep_devices() if d.ep_name == "QNNExecutionProvider" and d.device.type == ort.OrtHardwareDeviceType.NPU]
print("devices NPU:", len(npu), flush=True)

for fallback in ("1", "0"):
    so = ort.SessionOptions()
    so.add_session_config_entry("session.disable_cpu_ep_fallback", fallback)
    so.log_severity_level = 1 if fallback == "0" else 3
    ort.set_default_logger_severity(1 if fallback == "0" else 3)
    so.add_provider_for_devices(npu, {"backend_type": "htp", "htp_performance_mode": "burst"})
    print(f"--- disable_cpu_ep_fallback={fallback}", flush=True)
    try:
        s = ort.InferenceSession(model, sess_options=so)
        print("SESSION OK, providers:", s.get_providers(), flush=True)
    except Exception as e:
        print("ECHEC:", str(e)[:1500], flush=True)
