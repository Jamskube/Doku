// Hôte Tauri — ADR-0030 : le Rust est borné à trois rôles, secrets et réseau authentifié
// (`openai.rs`, `compat.rs`, `secrets.rs`, `web_search.rs`), cycle de vie du sidecar
// (`sidecar.rs`) et API système (Mica, instance unique, fichier d'ouverture). Tout l'I/O
// fichiers passe par les plugins officiels appelés depuis le frontend TypeScript (ADR-0004).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod compat;
mod openai;
mod secrets;
mod sidecar;
mod sse;
mod web_search;

use compat::CompatState;
use openai::OpenAiState;
use sidecar::OllamaState;
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, Listener, Manager, RunEvent, WebviewWindowBuilder};

// Le matériau Mica est rendu par le DWM, pas simulé dans la webview. Doku ne
// l'active qu'en thème sombre ; le thème clair restaure le chrome CSS opaque.
#[tauri::command]
fn set_system_backdrop(window: tauri::WebviewWindow, enabled: bool, dark: bool) -> bool {
    #[cfg(windows)]
    {
        if enabled {
            window_vibrancy::apply_mica(&window, Some(dark)).is_ok()
        } else {
            let _ = window_vibrancy::clear_mica(&window);
            false
        }
    }

    #[cfg(not(windows))]
    {
        let _ = (window, enabled, dark);
        false
    }
}

// Extrait un chemin de fichier des arguments (ignore l'exe en position 0 et les flags).
// Envoie un fichier ou un dossier à la corbeille du système (ADR-0030, API système). Le
// plugin-fs ne sait que supprimer définitivement ; pour des notes, c'est inacceptable.
#[tauri::command]
async fn move_to_trash(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || trash::delete(&path).map_err(|error| error.to_string()))
        .await
        .map_err(|error| error.to_string())?
}

fn file_from_args(args: &[String]) -> Option<String> {
    args.iter().skip(1).find(|a| !a.starts_with('-')).cloned()
}

// Une fenêtre de plus reprend la configuration de `main` (taille, sans bordure, invisible
// jusqu'au premier rendu). Seule `main` porte la session d'onglets : les autres démarrent vides.
fn create_window(app: &tauri::AppHandle, label: &str) -> Result<tauri::WebviewWindow, String> {
    let mut config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .cloned()
        .ok_or("fenêtre main absente de tauri.conf.json")?;
    config.label = label.into();
    let window = WebviewWindowBuilder::from_config(app, &config)
        .and_then(|builder| builder.build())
        .map_err(|error| error.to_string())?;
    show_if_still_hidden(window.clone());
    Ok(window)
}

// La fenêtre naît invisible ("visible": false) et c'est le frontend qui l'affiche une fois
// l'UI peinte (anti flash blanc). Filet de sécurité : si le JS ne démarre jamais, elle
// apparaît quand même après 4 s.
fn show_if_still_hidden(window: tauri::WebviewWindow) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(4));
        // Une erreur de lecture n'est pas une preuve de visibilité : tenter
        // show() est idempotent et constitue le vrai filet anti-fenêtre cachée.
        if !matches!(window.is_visible(), Ok(true)) {
            let _ = window.show();
        }
    });
}

// Le fichier de lancement n'est émis qu'une fois le frontend de `main` à l'écoute
// (handshake `doku://ready`), pour ne pas rater l'événement.
fn open_in_main_when_ready(app: &tauri::AppHandle, path: String) {
    let handle = app.clone();
    app.once("doku://ready", move |_| {
        let _ = handle.emit_to("main", "doku://open", path);
    });
}

static NEXT_WINDOW: AtomicUsize = AtomicUsize::new(1);

// Onglet déplacé vers une nouvelle fenêtre : son état (JSON opaque pour l'hôte) attend ici,
// sous le label de la fenêtre qui le reprend à son démarrage (`take_handoff`).
#[derive(Default)]
struct Handoffs(Mutex<HashMap<String, String>>);

// async : créer une fenêtre depuis une commande synchrone bloque la boucle d'événements sous Windows.
#[tauri::command]
async fn new_window(app: tauri::AppHandle, handoffs: tauri::State<'_, Handoffs>, handoff: Option<String>) -> Result<(), String> {
    let label = format!("doku-{}", NEXT_WINDOW.fetch_add(1, Ordering::Relaxed));
    if let Some(handoff) = handoff {
        handoffs.0.lock().unwrap_or_else(|e| e.into_inner()).insert(label.clone(), handoff);
    }
    create_window(&app, &label).map(|_| ()).inspect_err(|_| {
        handoffs.0.lock().unwrap_or_else(|e| e.into_inner()).remove(&label);
    })
}

#[tauri::command]
fn take_handoff(window: tauri::WebviewWindow, handoffs: tauri::State<'_, Handoffs>) -> Option<String> {
    handoffs.0.lock().unwrap_or_else(|e| e.into_inner()).remove(window.label())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // 2e lancement (ex. double-clic alors que l'app tourne) : on remonte la fenêtre
            // principale et on y ouvre le fichier passé — pas de 2e processus. Si elle a été
            // fermée pendant qu'une autre fenêtre vivait, on la recrée : elle rapporte la session.
            let path = file_from_args(&args);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
                if let Some(path) = path {
                    let _ = app.emit_to("main", "doku://open", path);
                }
            } else if create_window(app, "main").is_ok() {
                if let Some(path) = path {
                    open_in_main_when_ready(app, path);
                }
            }
        }))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        // Journal persistant : `%LOCALAPPDATA%/<identifier>/logs/doku.log`, un seul fichier
        // borné. Sans lui, un `console.error` du frontend ou un `panic = "abort"` ne
        // laissaient aucune trace à joindre à un rapport de bug.
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir { file_name: Some("doku".into()) }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                ])
                .max_file_size(2_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
                .build(),
        )
        .manage(OllamaState::new())
        .manage(OpenAiState::default())
        .manage(CompatState::default())
        .manage(Handoffs::default())
        .invoke_handler(tauri::generate_handler![
            set_system_backdrop,
            move_to_trash,
            new_window,
            take_handoff,
            sidecar::start_ollama,
            openai::openai_status,
            openai::openai_auth_start,
            openai::openai_auth_poll,
            openai::openai_auth_cancel,
            openai::openai_disconnect,
            openai::stream_openai,
            openai::cancel_openai,
            compat::compat_status,
            compat::compat_set_key,
            compat::compat_disconnect,
            compat::stream_compat,
            compat::cancel_compat,
            web_search::web_search,
        ])
        .setup(|app| {
            // 1er lancement : le fichier d'argument part vers la fenêtre principale.
            let args: Vec<String> = std::env::args().collect();
            if let Some(path) = file_from_args(&args) {
                open_in_main_when_ready(app.handle(), path);
            }
            if let Some(window) = app.get_webview_window("main") {
                show_if_still_hidden(window);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Doku")
        .run(|app, event| {
            // Arrêt du sidecar à la sortie (dernière fenêtre fermée), pas à la fermeture d'une
            // fenêtre parmi d'autres. Filet de sécurité : même si ce handler ne tourne pas (crash
            // de Doku), la fermeture du handle du Job Object à la mort du process tue tout
            // l'arbre (KILL_ON_JOB_CLOSE, cf. sidecar.rs).
            if let RunEvent::Exit = event {
                if let Some(state) = app.try_state::<OllamaState>() {
                    state.shutdown();
                }
            }
        });
}
