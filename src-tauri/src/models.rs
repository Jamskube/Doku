// Modèles locaux du moteur llama.cpp (ADR-0032) : un CATALOGUE fermé (fichiers GGUF épinglés à une
// révision Hugging Face, taille et SHA-256 connus), le téléchargement vérifié, la suppression, et
// le preset INI du routeur. Le frontend ne passe qu'un identifiant du catalogue : jamais d'URL
// arbitraire. Le téléchargement est la SEULE sortie réseau du moteur, sur action explicite.

use futures_util::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

pub struct ModelFile {
    pub file: &'static str,
    pub url: &'static str,
    pub sha256: &'static str,
    pub size: u64,
}

pub struct CatalogModel {
    pub id: &'static str,
    pub files: &'static [ModelFile],
    pub embedding: bool,
    pub ctx: u32,
    // Module rattaché à un autre modèle (mmproj) : pas de section propre dans le preset, il
    // s'ajoute à celle de son modèle (`mmproj = …`) quand les deux sont installés.
    pub attaches_to: Option<&'static str>,
}

pub const CATALOG: &[CatalogModel] = &[
    // LFM3-Omni-2B. Q4_0 : repacking ARM, plus rapide que Q4_K_M sur Snapdragon (spike llamacpp-lfm3).
    CatalogModel {
        id: "lfm3-omni-2b",
        files: &[ModelFile {
            file: "LFM3-Omni-2B-Q4_0.gguf",
            url: "https://huggingface.co/LiquidAI/LFM3-Omni-2B-GGUF/resolve/d508b88f08a5b4286f2d2805a6a8d69a0ff44c72/LFM3-Omni-2B-Q4_0.gguf",
            sha256: "6d2273a383b92dd7c5db0eb4c8dfeae13e805b485a6621c4b391ae179c2b5f28",
            size: 1_049_617_920,
        }],
        embedding: false,
        // = COPILOT_NUM_CTX (copilot-service.ts).
        ctx: 16384,
        attaches_to: None,
    },
    // Module audio et vision de LFM3 (mmproj Q8_0) : transcription et synthèse vocale du mode
    // vocal (ADR-0033). Chargé avec LFM3 dès qu'il est installé (~+0,5 Go de RAM).
    CatalogModel {
        id: "lfm3-omni-2b-voice",
        files: &[ModelFile {
            file: "mmproj-LFM3-Omni-2B-Q8_0.gguf",
            url: "https://huggingface.co/LiquidAI/LFM3-Omni-2B-GGUF/resolve/d508b88f08a5b4286f2d2805a6a8d69a0ff44c72/mmproj-LFM3-Omni-2B-Q8_0.gguf",
            sha256: "8a25f9d1931244429de404fccacfb7fb933970a36aa5688d2f5069f29c6b27b1",
            size: 506_842_528,
        }],
        embedding: false,
        ctx: 0,
        attaches_to: Some("lfm3-omni-2b"),
    },
    // Embeddings du RAG (ADR-0015) : granite 278M multilingue, 768 dimensions.
    CatalogModel {
        id: "granite-embedding-278m",
        files: &[ModelFile {
            file: "granite-embedding-278m-multilingual-Q8_0.gguf",
            url: "https://huggingface.co/bartowski/granite-embedding-278m-multilingual-GGUF/resolve/61fba13303a369d52a088ccb745be93ecc2034f3/granite-embedding-278m-multilingual-Q8_0.gguf",
            sha256: "b8b3ebc5f98d179493adf28e6e9e16508766ed85b72cedfbd9bc1540c4905a23",
            size: 303_137_952,
        }],
        embedding: true,
        ctx: 512,
        attaches_to: None,
    },
];

fn models_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("llama-models");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn is_installed(dir: &std::path::Path, model: &CatalogModel) -> bool {
    model.files.iter().all(|f| dir.join(f.file).is_file())
}

#[derive(Serialize)]
pub struct LocalModel {
    name: String,
    size: u64,
    // « chat », « embedding » ou « voice » (module rattaché) : la webview ne devine plus au nom.
    kind: &'static str,
}

fn kind(m: &CatalogModel) -> &'static str {
    if m.attaches_to.is_some() {
        "voice"
    } else if m.embedding {
        "embedding"
    } else {
        "chat"
    }
}

#[tauri::command]
pub fn local_models(app: tauri::AppHandle) -> Result<Vec<LocalModel>, String> {
    let dir = models_dir(&app)?;
    Ok(CATALOG
        .iter()
        .filter(|m| is_installed(&dir, m))
        .map(|m| LocalModel { name: m.id.to_string(), size: m.files.iter().map(|f| f.size).sum(), kind: kind(m) })
        .collect())
}

// Preset du routeur : seuls les modèles installés. Réglages imposés (les défauts de llama.cpp
// divisent le decode par 5 ici) : 4 threads au plus, un seul slot, pas de mmap.
pub fn write_preset(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = models_dir(app)?;
    // ponytail: 4 threads mesurés optimaux sur Snapdragon X (10 cœurs) ; à re-mesurer sur x64.
    let threads = std::thread::available_parallelism().map(|n| n.get().min(4)).unwrap_or(4);
    // repeat-penalty 1.1 = le défaut d'Ollama ; celui de llama.cpp (1.0) laisse LFM3 boucler (12 000
    // tokens mesurés sur un poème). n-predict borne toute sortie, même si le client oublie.
    let preset = dir.join("models.ini");
    std::fs::write(&preset, preset_ini(&dir, threads)).map_err(|e| e.to_string())?;
    Ok(preset)
}

fn preset_ini(dir: &std::path::Path, threads: usize) -> String {
    let path_of = |file: &str| dir.join(file).to_string_lossy().replace('\\', "/");
    let mut ini = format!(
        "version = 1\n\n[*]\nthreads = {threads}\nparallel = 1\nload-mode = none\nrepeat-penalty = 1.1\nn-predict = 4096\n"
    );
    let installed: Vec<&CatalogModel> = CATALOG.iter().filter(|m| is_installed(dir, m)).collect();
    for m in installed.iter().filter(|m| m.attaches_to.is_none()) {
        ini.push_str(&format!("\n[{}]\nmodel = {}\nc = {}\n", m.id, path_of(m.files[0].file), m.ctx));
        ini.push_str(if m.embedding { "embedding = true\n" } else { "reasoning = off\n" });
        for addon in installed.iter().filter(|a| a.attaches_to == Some(m.id)) {
            ini.push_str(&format!("mmproj = {}\n", path_of(addon.files[0].file)));
        }
    }
    ini
}

#[derive(Default)]
pub struct DownloadState {
    busy: AtomicBool,
    cancel: AtomicBool,
}

#[derive(Clone, Serialize)]
struct Progress {
    id: &'static str,
    done: u64,
    total: u64,
}

// Télécharge les fichiers manquants d'un modèle du catalogue, en vérifiant le SHA-256 avant de
// les poser à leur nom final (un fichier partiel ou corrompu n'est jamais pris pour installé).
// Rend `false` si l'utilisateur a annulé. Progression : événement `model-download`.
#[tauri::command]
pub async fn download_model(
    app: tauri::AppHandle,
    state: tauri::State<'_, DownloadState>,
    engine: tauri::State<'_, crate::sidecar::EngineState>,
    id: String,
) -> Result<bool, String> {
    let model = CATALOG.iter().find(|m| m.id == id).ok_or_else(|| format!("Modèle inconnu : {id}"))?;
    if state.busy.swap(true, Ordering::SeqCst) {
        return Err("Un téléchargement est déjà en cours.".into());
    }
    state.cancel.store(false, Ordering::SeqCst);
    let result = download_files(&app, &state, model).await;
    state.busy.store(false, Ordering::SeqCst);
    // Le preset du routeur ne connaît que les modèles présents au démarrage.
    if matches!(result, Ok(true)) {
        engine.shutdown();
    }
    result
}

async fn download_files(app: &tauri::AppHandle, state: &DownloadState, model: &CatalogModel) -> Result<bool, String> {
    let dir = models_dir(app)?;
    let total: u64 = model.files.iter().map(|f| f.size).sum();
    let mut done: u64 = model.files.iter().filter(|f| dir.join(f.file).is_file()).map(|f| f.size).sum();
    let client = reqwest::Client::builder()
        .user_agent("Doku")
        .connect_timeout(Duration::from_secs(20))
        .read_timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;
    let _ = app.emit("model-download", Progress { id: model.id, done, total });

    for f in model.files.iter().filter(|f| !dir.join(f.file).is_file()) {
        let partial = dir.join(format!("{}.partial", f.file));
        let response = client
            .get(f.url)
            .send()
            .await
            .and_then(|r| r.error_for_status())
            .map_err(|e| format!("Téléchargement impossible : {e}"))?;
        let mut out = std::fs::File::create(&partial).map_err(|e| e.to_string())?;
        let mut hasher = Sha256::new();
        let mut stream = response.bytes_stream();
        let mut last = Instant::now();
        while let Some(chunk) = stream.next().await {
            if state.cancel.load(Ordering::SeqCst) {
                drop(out);
                let _ = std::fs::remove_file(&partial);
                return Ok(false);
            }
            let chunk = match chunk {
                Ok(c) => c,
                Err(e) => {
                    drop(out);
                    let _ = std::fs::remove_file(&partial);
                    return Err(format!("Téléchargement interrompu : {e}"));
                }
            };
            hasher.update(&chunk);
            if let Err(e) = out.write_all(&chunk) {
                drop(out);
                let _ = std::fs::remove_file(&partial);
                return Err(format!("Écriture impossible : {e}"));
            }
            done += chunk.len() as u64;
            if last.elapsed() >= Duration::from_millis(150) {
                last = Instant::now();
                let _ = app.emit("model-download", Progress { id: model.id, done, total });
            }
        }
        drop(out);
        let digest = format!("{:x}", hasher.finalize());
        if digest != f.sha256 {
            let _ = std::fs::remove_file(&partial);
            return Err(format!("Fichier corrompu ({}) : empreinte inattendue.", f.file));
        }
        std::fs::rename(&partial, dir.join(f.file)).map_err(|e| e.to_string())?;
    }
    let _ = app.emit("model-download", Progress { id: model.id, done: total, total });
    Ok(true)
}

#[tauri::command]
pub fn cancel_model_download(state: tauri::State<'_, DownloadState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

// Supprime les fichiers d'un modèle. Le moteur est arrêté d'abord : Windows refuse d'effacer un
// fichier qu'un process garde ouvert, et le preset doit l'oublier.
#[tauri::command]
pub fn delete_model(
    app: tauri::AppHandle,
    engine: tauri::State<'_, crate::sidecar::EngineState>,
    id: String,
) -> Result<(), String> {
    let model = CATALOG.iter().find(|m| m.id == id).ok_or_else(|| format!("Modèle inconnu : {id}"))?;
    engine.shutdown();
    let dir = models_dir(&app)?;
    for f in model.files {
        let path = dir.join(f.file);
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| format!("Suppression impossible ({}) : {e}", f.file))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(dir: &std::path::Path, file: &str) {
        std::fs::write(dir.join(file), b"x").unwrap();
    }

    #[test]
    fn preset_attaches_voice_module_to_its_model_only() {
        let dir = std::env::temp_dir().join(format!("doku-preset-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        touch(&dir, "LFM3-Omni-2B-Q4_0.gguf");
        let without = preset_ini(&dir, 4);
        assert!(without.contains("[lfm3-omni-2b]"));
        assert!(!without.contains("mmproj"));

        touch(&dir, "mmproj-LFM3-Omni-2B-Q8_0.gguf");
        touch(&dir, "granite-embedding-278m-multilingual-Q8_0.gguf");
        let with = preset_ini(&dir, 4);
        // Le module n'a pas de section propre ; il suit LFM3, pas granite.
        assert!(!with.contains("[lfm3-omni-2b-voice]"));
        let lfm3 = with.split("[granite-embedding-278m]").next().unwrap();
        assert!(lfm3.contains("mmproj = ") && lfm3.contains("mmproj-LFM3-Omni-2B-Q8_0.gguf"));
        let granite = with.split("[granite-embedding-278m]").nth(1).unwrap();
        assert!(!granite.contains("mmproj"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
