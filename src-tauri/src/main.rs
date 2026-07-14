// Hôte Tauri minimal — ADR-0004 : zéro logique métier ici, tout l'I/O passe
// par les plugins officiels appelés depuis le frontend TypeScript. Rôles Rust :
// instance unique, fenêtre, transmission du fichier d'ouverture (2.3), et — exception
// documentée (ADR-0012) — le cycle de vie du sidecar Ollama (spawn + port + kill).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpListener;
use std::sync::Mutex;
use tauri::{Emitter, Listener, Manager, WindowEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

// Extrait un chemin de fichier des arguments (ignore l'exe en position 0 et les flags).
fn file_from_args(args: &[String]) -> Option<String> {
    args.iter().skip(1).find(|a| !a.starts_with('-')).cloned()
}

// État du sidecar Ollama (13.1) : le process enfant + son port. Seul « morceau de logique »
// Rust admis (ADR-0004) = coquille spawn + port + kill.
struct OllamaState(Mutex<Option<(CommandChild, u16)>>);

// Port TCP libre sur loopback : bind éphémère puis relâche (le listener est droppé à la
// sortie). Fenêtre TOCTOU minime, acceptée en mono-utilisateur (ADR-0012).
fn free_loopback_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    listener.local_addr().map(|a| a.port()).map_err(|e| e.to_string())
}

// Démarre `ollama serve` en sidecar sur un port éphémère, modèles isolés dans
// %APPDATA%\<app>\models (OLLAMA_MODELS), origine CORS = celle de la webview. Idempotent :
// si déjà lancé, renvoie le port courant. Le spawn se fait HORS verrou (M3 : ne pas bloquer
// un kill concurrent pendant le démarrage).
#[tauri::command]
async fn start_ollama(app: tauri::AppHandle, state: tauri::State<'_, OllamaState>) -> Result<u16, String> {
    if let Some((_, port)) = state.0.lock().unwrap().as_ref() {
        return Ok(*port);
    }
    let port = free_loopback_port()?;
    let models = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("models");
    std::fs::create_dir_all(&models).map_err(|e| e.to_string())?;

    let (mut rx, child) = app
        .shell()
        .sidecar("ollama")
        .map_err(|e| e.to_string())?
        .args(["serve"])
        .env("OLLAMA_HOST", format!("127.0.0.1:{port}"))
        .env("OLLAMA_MODELS", models.to_string_lossy().to_string())
        .env("OLLAMA_ORIGINS", "http://tauri.localhost")
        .spawn()
        .map_err(|e| e.to_string())?;

    // Draine les événements du sidecar : stderr = diagnostic n°1 d'un binaire ARM64 invalide
    // ou d'un port déjà pris ; Terminated distingue « sorti » de « lent à répondre » (H3).
    tauri::async_runtime::spawn(async move {
        while let Some(ev) = rx.recv().await {
            match ev {
                CommandEvent::Stderr(b) => eprintln!("[ollama] {}", String::from_utf8_lossy(&b)),
                CommandEvent::Stdout(b) => println!("[ollama] {}", String::from_utf8_lossy(&b)),
                CommandEvent::Terminated(p) => {
                    eprintln!("[ollama] terminé (code {:?})", p.code);
                    break;
                }
                _ => {}
            }
        }
    });

    // Re-vérifie SOUS verrou : deux appels concurrents ont pu voir None et spawn chacun.
    // Le perdant tue son enfant (sinon orphelin qui viole « kill propre »).
    let mut guard = state.0.lock().unwrap();
    if let Some((_, existing)) = guard.as_ref() {
        let _ = child.kill();
        return Ok(*existing);
    }
    *guard = Some((child, port));
    Ok(port)
}

#[tauri::command]
async fn stop_ollama(state: tauri::State<'_, OllamaState>) -> Result<(), String> {
    let taken = state.0.lock().unwrap().take();
    if let Some((child, _)) = taken {
        child.kill().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // 2e lancement (ex. double-clic alors que l'app tourne) : on remonte
            // l'instance existante et on y ouvre le fichier passé — pas de 2e fenêtre.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            if let Some(path) = file_from_args(&args) {
                let _ = app.emit("doku://open", path);
            }
        }))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(OllamaState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![start_ollama, stop_ollama])
        .on_window_event(|window, event| {
            // Tue le sidecar à la DESTRUCTION de la fenêtre — pas sur CloseRequested : la
            // garde « non enregistré » du frontend peut annuler la fermeture, ce qui
            // laisserait l'app ouverte avec le moteur mort (critique M2).
            if let WindowEvent::Destroyed = event {
                if let Some(state) = window.app_handle().try_state::<OllamaState>() {
                    if let Some((child, _)) = state.0.lock().unwrap().take() {
                        let _ = child.kill();
                    }
                }
            }
        })
        .setup(|app| {
            // 1er lancement : émet le fichier d'argument une fois le frontend prêt
            // (handshake `doku://ready`), pour ne pas rater l'événement.
            let args: Vec<String> = std::env::args().collect();
            if let Some(path) = file_from_args(&args) {
                let handle = app.handle().clone();
                handle.clone().once("doku://ready", move |_| {
                    let _ = handle.emit("doku://open", path);
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Doku");
}
