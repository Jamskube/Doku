// SidecarManager (13.2, ADR-0012) — cycle de vie du sidecar Ollama : port éphémère, spawn
// paresseux, et surtout un KILL FIABLE de tout l'arbre de process — `ollama.exe` + son
// grand-enfant `llama-server.exe` — même si Doku CRASHE, via un Job Object Windows
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
    AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject, TerminateJobObject,
    JobObjectExtendedLimitInformation, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
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
    listener.local_addr().map(|a| a.port()).map_err(|e| e.to_string())
}

pub struct OllamaState {
    child: Mutex<Option<(CommandChild, u16)>>,
    #[cfg(windows)]
    job: Job,
}

impl OllamaState {
    pub fn new() -> Result<Self, String> {
        Ok(Self {
            child: Mutex::new(None),
            #[cfg(windows)]
            job: create_kill_on_close_job()?,
        })
    }

    // Arrêt propre : tue l'arbre (ollama + llama-server) et oublie l'enfant. Le job reste
    // réutilisable pour un prochain start. Idempotent. Le verrou est TENU pendant le terminate
    // pour sérialiser avec l'assign+store de `start_ollama` (sinon on pourrait tuer un sidecar
    // qui vient d'être démarré et rapporté vivant).
    pub fn shutdown(&self) {
        let mut guard = self.child.lock().unwrap();
        let taken = guard.take();
        #[cfg(windows)]
        terminate_job(&self.job);
        if let Some((child, _)) = taken {
            let _ = child.kill();
        }
    }
}

// Démarre `ollama serve` en sidecar (idempotent). Port éphémère, modèles isolés, cloud coupé
// (8.3), et l'enfant est rattaché au Job Object pour un kill d'arbre garanti.
#[tauri::command]
pub async fn start_ollama(app: tauri::AppHandle, state: tauri::State<'_, OllamaState>) -> Result<u16, String> {
    if let Some((_, port)) = state.child.lock().unwrap().as_ref() {
        return Ok(*port);
    }
    let port = free_loopback_port()?;
    let models = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("models");
    std::fs::create_dir_all(&models).map_err(|e| e.to_string())?;

    // Où Ollama trouve lib/ollama (llama-server.exe + DLLs ggml), chargé relativement à ce
    // chemin. DEV : le sidecar tourne depuis target/debug → on pointe vers src-tauri/binaries
    // (la lib réelle y est extraite). RELEASE : bundle.resources copie lib/ollama sous
    // resource_dir() (à côté de l'exe empaqueté).
    let lib_base = if cfg!(debug_assertions) {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries")
    } else {
        app.path().resource_dir().map_err(|e| e.to_string())?
    };

    let (mut rx, child) = app
        .shell()
        .sidecar("ollama")
        .map_err(|e| e.to_string())?
        .args(["serve"])
        .env("OLLAMA_HOST", format!("127.0.0.1:{port}"))
        .env("OLLAMA_MODELS", models.to_string_lossy().to_string())
        .env("OLLAMA_LIBRARY_PATH", lib_base.to_string_lossy().to_string())
        .env("OLLAMA_NO_CLOUD", "1") // coupe le poll model_recommendations -> ollama.com (8.3)
        .env("OLLAMA_REMOTES", "127.0.0.1") // ceinture : neutralise l'allow-list distante
        .env("OLLAMA_ORIGINS", "http://tauri.localhost")
        .spawn()
        .map_err(|e| e.to_string())?;

    // Draine les événements : stderr = diagnostic n°1 (binaire ARM64 invalide, port pris) ;
    // Terminated distingue « sorti » de « lent à répondre » ET auto-répare l'état : si le
    // sidecar meurt, on vide le slot (seulement si c'est encore CE port) → un prochain
    // start_ollama re-spawn au lieu de renvoyer un port mort à vie.
    let drain_app = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(ev) = rx.recv().await {
            match ev {
                CommandEvent::Stderr(b) => eprintln!("[ollama] {}", String::from_utf8_lossy(&b)),
                CommandEvent::Stdout(b) => println!("[ollama] {}", String::from_utf8_lossy(&b)),
                CommandEvent::Terminated(p) => {
                    eprintln!("[ollama] terminé (code {:?})", p.code);
                    if let Some(state) = drain_app.try_state::<OllamaState>() {
                        let mut g = state.child.lock().unwrap();
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
    // NB : cette fonction async ne contient AUCUN `.await` (spawn shell synchrone) → les gardes
    // du `std::sync::Mutex` ne traversent jamais un point de suspension. Ne pas ajouter d'await
    // entre les prises de verrou sans repasser en Mutex async.
    let mut guard = state.child.lock().unwrap();
    if let Some((_, existing)) = guard.as_ref() {
        // Course perdue : ce process n'a pas encore d'enfant llama-server (spawné paresseusement
        // au 1er modèle), donc child.kill() suffit — dépendant du timing, pas une garantie.
        let _ = child.kill();
        return Ok(*existing);
    }
    #[cfg(windows)]
    if let Err(e) = assign_to_job(&state.job, child.pid()) {
        let _ = child.kill();
        return Err(e);
    }
    *guard = Some((child, port));
    Ok(port)
}

#[tauri::command]
pub async fn stop_ollama(state: tauri::State<'_, OllamaState>) -> Result<(), String> {
    state.shutdown();
    Ok(())
}
