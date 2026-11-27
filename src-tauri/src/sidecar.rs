// SidecarManager (13.2, ADR-0012 ; moteur llama.cpp depuis ADR-0032) — cycle de vie du moteur IA
// local : port éphémère, spawn paresseux, et surtout un KILL FIABLE de tout l'arbre de process —
// le routeur `llama-server` + un enfant par modèle chargé — même si Doku CRASHE, via un Job Object Windows
// KILL_ON_JOB_CLOSE : le noyau termine les process du job dès que le dernier handle se ferme,
// ce qui arrive à la mort du process Doku (fermeture propre OU crash). Cela SUPERSÈDE le
// pidfile+sweep d'ADR-0012 (pas de hasard de réutilisation de PID, nettoyage garanti noyau).
// Reste « Rust minimal » (ADR-0004) : spawn + port + kill, aucune inférence in-process.

use std::net::TcpListener;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

#[cfg(windows)]
use windows::core::PCWSTR;
#[cfg(windows)]
use windows::Win32::Foundation::{CloseHandle, HANDLE};
#[cfg(windows)]
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
#[cfg(windows)]
use windows::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

// HANDLE = *mut c_void → ni Send ni Sync. Un handle de Job est global au process et sûr à
// partager entre threads ; on l'assère explicitement pour le stocker dans le State Tauri.
#[cfg(windows)]
struct Job(HANDLE);
#[cfg(windows)]
unsafe impl Send for Job {}
#[cfg(windows)]
unsafe impl Sync for Job {}

#[cfg(windows)]
fn create_kill_on_close_job() -> Result<Job, String> {
    unsafe {
        let job = CreateJobObjectW(None, PCWSTR::null()).map_err(|e| e.to_string())?;
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        // Le flag KILL_ON_JOB_CLOSE se pose via SetInformationJobObject, pas à la création.
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION as *const core::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
        .map_err(|e| e.to_string())?;
        Ok(Job(job))
    }
}

// Rattache un process (par PID) au job. Ses enfants créés ENSUITE (ex. llama-server, spawné
// paresseusement au 1er chargement de modèle) héritent du job → tués avec lui.
#[cfg(windows)]
fn assign_to_job(job: &Job, pid: u32) -> Result<(), String> {
    unsafe {
        let proc = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid)
            .map_err(|e| e.to_string())?;
        let res = AssignProcessToJobObject(job.0, proc).map_err(|e| e.to_string());
        let _ = CloseHandle(proc); // l'association survit à la fermeture de ce handle process
        res
    }
}

#[cfg(windows)]
fn terminate_job(job: &Job) {
    unsafe {
        let _ = TerminateJobObject(job.0, 0);
    }
}

// Port TCP libre sur loopback : bind éphémère puis relâche (listener droppé). TOCTOU minime,
// accepté en mono-utilisateur (ADR-0012).
fn free_loopback_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    listener
        .local_addr()
        .map(|a| a.port())
        .map_err(|e| e.to_string())
}

pub struct EngineState {
    child: Mutex<Option<(CommandChild, u16)>>,
    // Le Job Object, ou la RAISON de son absence. Garder l'erreur plutôt qu'un simple `None`
    // permet de la rendre à l'utilisateur au moment où elle compte — quand il essaie de
    // démarrer l'IA — au lieu de la perdre au lancement de l'application.
    #[cfg(windows)]
    job: Result<Job, String>,
}

impl EngineState {
    // INFAILLIBLE, volontairement. Auparavant cette fonction rendait un `Result` que `main.rs`
    // dépliait avec `.expect(...)` : si la création du Job Object échouait, Doku PANIQUAIT AU
    // DÉMARRAGE — un éditeur Markdown refusant de s'ouvrir parce que le bac à sable d'un
    // sidecar d'IA optionnel n'a pas pu être créé. L'échec est désormais MÉMORISÉ au lieu
    // d'être fatal : l'application démarre, et c'est le démarrage du sidecar qui refusera,
    // avec sa raison. On ne lance jamais un process qu'on ne saurait pas tuer.
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
            #[cfg(windows)]
            job: create_kill_on_close_job(),
        }
    }

    // Arrêt propre : tue l'arbre (routeur llama-server + enfants) et oublie l'enfant. Le job reste
    // réutilisable pour un prochain start. Idempotent. Le verrou est TENU pendant le terminate
    // pour sérialiser avec l'assign+store de `start_engine` (sinon on pourrait tuer un sidecar
    // qui vient d'être démarré et rapporté vivant).
    // `unwrap_or_else(|e| e.into_inner())` plutôt que `.unwrap()` sur les quatre prises de ce
    // verrou : si un thread panique en le tenant, le mutex est EMPOISONNÉ et tout `.unwrap()`
    // ultérieur fait paniquer à son tour. Le sidecar est un service secondaire — sa défaillance
    // ne doit pas emporter l'hôte, et surtout pas empêcher `shutdown()` de tuer l'arbre de
    // process. L'état protégé est un `Option<(child, port)>` : une panique ne peut pas le
    // laisser à moitié écrit, donc le récupérer est sûr.
    pub fn shutdown(&self) {
        let mut guard = self.child.lock().unwrap_or_else(|e| e.into_inner());
        let taken = guard.take();
        #[cfg(windows)]
        if let Ok(job) = &self.job {
            terminate_job(job);
        }
        if let Some((child, _)) = taken {
            let _ = child.kill();
        }
    }
}

#[cfg(windows)]
fn spawn_error<E: std::fmt::Display>(error: E) -> String {
    error.to_string()
}

#[cfg(not(windows))]
fn spawn_error<E: std::fmt::Display>(error: E) -> String {
    format!("Le moteur IA n’a pas pu démarrer : {error}")
}

// Le moteur llama.cpp livré avec Doku (scripts/prepare-llama-sidecar.mjs) : en DEV, le dossier
// préparé sous src-tauri/binaries ; en RELEASE, la ressource `llama/` à côté de l'exécutable.
fn engine_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    if cfg!(debug_assertions) {
        Ok(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries").join("llama"))
    } else {
        Ok(app.path().resource_dir().map_err(|e| e.to_string())?.join("llama"))
    }
}

// Origine autorisée à interroger le moteur (CORS, défaut `*` chez llama.cpp) : la webview de
// Doku seulement. UNE origine : llama.cpp recopie la valeur telle quelle dans
// `Access-Control-Allow-Origin`, et une liste y est rejetée par le navigateur (moteur muet).
fn cors_origins() -> &'static str {
    if cfg!(debug_assertions) {
        "http://localhost:1420"
    } else if cfg!(windows) {
        "http://tauri.localhost"
    } else {
        "tauri://localhost"
    }
}

// Démarre `llama-server` en mode routeur (idempotent) : un point d'entrée, un process enfant par
// modèle chargé (hérite du Job Object), modèles = ceux installés (preset INI régénéré à chaque
// démarrage). Hors ligne forcé, interface web coupée, CORS restreint (ADR-0032).
#[tauri::command]
pub async fn start_engine(
    app: tauri::AppHandle,
    state: tauri::State<'_, EngineState>,
) -> Result<u16, String> {
    if let Some((_, port)) = state.child.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
        return Ok(*port);
    }
    let port = free_loopback_port()?;
    let preset = crate::models::write_preset(&app)?;
    let dir = engine_dir(&app)?;
    let exe = dir.join(if cfg!(windows) { "llama-server.exe" } else { "llama-server" });
    if !exe.exists() {
        return Err(format!(
            "Le moteur IA est absent ({}). Lancez « npm run prepare:llama:arm64 » (ou x64).",
            exe.display()
        ));
    }

    let command = app
        .shell()
        .command(exe.to_string_lossy().to_string())
        .current_dir(&dir)
        .args([
            "--host",
            "127.0.0.1",
            "--port",
            &port.to_string(),
            "--models-preset",
            &preset.to_string_lossy(),
            "--models-max",
            "2",
            "--offline",
            "--no-ui",
            "--cors-origins",
            cors_origins(),
        ]);
    // Les .so du build Ubuntu vivent à côté du binaire.
    #[cfg(not(windows))]
    let command = command.env("LD_LIBRARY_PATH", dir.to_string_lossy().to_string());

    let (mut rx, child) = command.spawn().map_err(spawn_error)?;

    // Draine les événements : stderr = diagnostic n°1 ; Terminated auto-répare l'état (le slot
    // est vidé si c'est encore CE port) → un prochain start relance au lieu de rendre un port mort.
    let drain_app = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(ev) = rx.recv().await {
            match ev {
                CommandEvent::Stderr(b) => eprintln!("[llama] {}", String::from_utf8_lossy(&b)),
                CommandEvent::Stdout(b) => println!("[llama] {}", String::from_utf8_lossy(&b)),
                CommandEvent::Terminated(p) => {
                    eprintln!("[llama] terminé (code {:?})", p.code);
                    if let Some(state) = drain_app.try_state::<EngineState>() {
                        let mut g = state.child.lock().unwrap_or_else(|e| e.into_inner());
                        if matches!(g.as_ref(), Some((_, stored)) if *stored == port) {
                            *g = None;
                        }
                    }
                    break;
                }
                _ => {}
            }
        }
    });

    // Re-vérifie SOUS verrou (deux starts concurrents) puis rattache au job avant de stocker.
    // Aucun `.await` entre les prises du `std::sync::Mutex` (spawn synchrone) : ne pas en ajouter.
    let mut guard = state.child.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((_, existing)) = guard.as_ref() {
        let _ = child.kill();
        return Ok(*existing);
    }
    // Sans Job Object, on REFUSE de démarrer : les enfants du routeur resteraient orphelins.
    #[cfg(windows)]
    match &state.job {
        Ok(job) => {
            if let Err(e) = assign_to_job(job, child.pid()) {
                let _ = child.kill();
                return Err(e);
            }
        }
        Err(raison) => {
            let _ = child.kill();
            return Err(format!(
                "L’assistant local ne peut pas démarrer : {raison}. Le reste de Doku fonctionne normalement."
            ));
        }
    }
    *guard = Some((child, port));
    Ok(port)
}

// Arrête le moteur (téléchargement ou suppression d'un modèle : le preset change, et Windows
// refuse d'effacer un fichier qu'un process garde ouvert). Le prochain usage le relance.
#[tauri::command]
pub fn stop_engine(state: tauri::State<'_, EngineState>) {
    state.shutdown();
}
