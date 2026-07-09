// Hôte Tauri minimal — ADR-0004 : zéro logique métier ici, tout l'I/O passe
// par les plugins officiels appelés depuis le frontend TypeScript. Le seul rôle
// Rust : instance unique, fenêtre, et transmission du fichier d'ouverture (2.3).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Emitter, Listener, Manager};

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
