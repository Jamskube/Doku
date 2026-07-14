// Hôte Tauri minimal — ADR-0004 : zéro logique métier ici, tout l'I/O passe par les plugins
// officiels appelés depuis le frontend TypeScript. Rôles Rust : instance unique, fenêtre,
// transmission du fichier d'ouverture (2.3), et — exception documentée (ADR-0012) — le cycle
// de vie du sidecar Ollama, isolé dans `sidecar.rs`.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod sidecar;

use sidecar::OllamaState;
use tauri::{Emitter, Listener, Manager, WindowEvent};

// Extrait un chemin de fichier des arguments (ignore l'exe en position 0 et les flags).
fn file_from_args(args: &[String]) -> Option<String> {
    args.iter().skip(1).find(|a| !a.starts_with('-')).cloned()
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
        .manage(OllamaState::new().expect("création du Job Object du sidecar Ollama"))
        .invoke_handler(tauri::generate_handler![sidecar::start_ollama, sidecar::stop_ollama])
        .on_window_event(|window, event| {
            // Arrêt du sidecar à la destruction de la fenêtre. Filet de sécurité : même si ce
            // handler ne tourne pas (crash de Doku), la fermeture du handle du Job Object à la
            // mort du process tue tout l'arbre (KILL_ON_JOB_CLOSE, cf. sidecar.rs).
            if let WindowEvent::Destroyed = event {
                if let Some(state) = window.app_handle().try_state::<OllamaState>() {
                    state.shutdown();
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
