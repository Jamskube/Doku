// Fournisseurs cloud COMPATIBLES OpenAI (ADR-0018) : clé API + POST /chat/completions
// streamé. Registre EN DUR — la base URL n'est jamais configurable depuis le frontend ni
// settings.json : une clé volée ne peut pas être redirigée vers un autre hôte. La clé
// traverse l'IPC une fois à la connexion, est validée par un appel à 1 token AVANT d'être
// stockée (Credential Manager), n'est jamais renvoyée par aucune commande.
use crate::secrets::{delete_secret, read_secret, write_secret};
use crate::sse::{find_sse_boundary, parse_sse_event, SseEvent};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::Duration,
};
use tauri::{ipc::Channel, State};
use tokio::sync::oneshot;

// Client bornÉ pour les appels COURTS (validation, statut) : sans timeout, une connexion
// aspirée (pare-feu, portail captif) laisserait « Vérification… » gelé pour toujours.
// Le STREAMING garde un client sans timeout global (une génération peut durer).
fn short_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .expect("client HTTP")
    })
}

// MiniMax signale ses erreurs applicatives en HTTP 200 avec `base_resp.status_code != 0`
// (`1004` = clé invalide…) : le statut HTTP seul ne prouve RIEN. Renvoie l'erreur
// applicative d'un corps JSON, ou None si le corps est sain.
fn base_resp_error(json: &Value) -> Option<(i64, String)> {
    let code = json.pointer("/base_resp/status_code").and_then(Value::as_i64)?;
    if code == 0 {
        return None;
    }
    let msg = json
        .pointer("/base_resp/status_msg")
        .and_then(Value::as_str)
        .unwrap_or("erreur du service")
        .to_string();
    Some((code, msg))
}

// Codes base_resp « clé invalide / non autorisée » connus de MiniMax.
fn is_auth_code(code: i64) -> bool {
    matches!(code, 1004 | 1008 | 2049)
}

struct ProviderDef {
    id: &'static str,
    /// Nom du secret dans les messages d'erreur (« la clé MiniMax »).
    what: &'static str,
    base_url: &'static str,
    key_target: &'static str,
    /// Catalogue de repli : la surface compatible de MiniMax n'expose pas GET /models
    /// (vérifié sur la doc officielle) — on tente quand même, ceci couvre le 404.
    default_models: &'static [&'static str],
    /// Modèle employé pour la validation de clé (1 token) — le moins cher du catalogue.
    probe_model: &'static str,
}

const PROVIDERS: &[ProviderDef] = &[ProviderDef {
    id: "minimax",
    what: "la clé MiniMax",
    base_url: "https://api.minimax.io/v1",
    key_target: "Doku/MiniMax/api-key",
    default_models: &[
        "MiniMax-M3",
        "MiniMax-M2.7",
        "MiniMax-M2.7-highspeed",
        "MiniMax-M2.5",
        "MiniMax-M2.5-highspeed",
        "MiniMax-M2.1",
        "MiniMax-M2",
    ],
    probe_model: "MiniMax-M2.5-highspeed",
}];

fn provider(id: &str) -> Result<&'static ProviderDef, String> {
    PROVIDERS
        .iter()
        .find(|p| p.id == id)
        .ok_or_else(|| "Fournisseur cloud inconnu.".to_string())
}

#[derive(Default)]
pub struct CompatState {
    cancellations: Mutex<HashMap<String, oneshot::Sender<()>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompatStatus {
    key_present: bool,
    connected: bool,
    /// La clé a été REFUSÉE par le service (401/403) — distinct d'un réseau en panne :
    /// la carte doit dire « clé refusée, reconnectez » (jamais de fonctionnalité qui ment).
    key_rejected: bool,
    models: Vec<String>,
    error: Option<String>,
}

#[derive(Deserialize, Serialize)]
pub struct CompatMessage {
    role: String,
    content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompatRequest {
    request_id: String,
    provider: String,
    model: String,
    messages: Vec<CompatMessage>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CompatStreamEvent {
    kind: &'static str,
    text: Option<String>,
}

fn api_error(def: &ProviderDef, status: reqwest::StatusCode, body: &str) -> String {
    let detail = serde_json::from_str::<Value>(body).ok().and_then(|json| {
        json.pointer("/error/message")
            .and_then(Value::as_str)
            .map(str::to_owned)
    });
    match status.as_u16() {
        401 | 403 => format!(
            "{} n'est plus acceptée par le service. Reconnectez-la dans Modèles.",
            capitalize(def.what)
        ),
        429 => detail.unwrap_or_else(|| "Limite d'utilisation du fournisseur atteinte.".to_string()),
        _ => detail.unwrap_or_else(|| format!("Le fournisseur a répondu avec l'erreur {status}.")),
    }
}

fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

// Modèles via GET /models (format OpenAI `{ data: [{ id }] }`). La plupart des surfaces
// compatibles le servent ; MiniMax ne le documente pas → le 404 tombe sur le catalogue
// de repli, un 401/403 remonte comme clé refusée.
async fn fetch_models(def: &ProviderDef, key: &str) -> Result<Vec<String>, ModelsFailure> {
    let response = short_client()
        .get(format!("{}/models", def.base_url))
        .bearer_auth(key)
        .send()
        .await
        .map_err(|_| ModelsFailure::Transport)?;
    match response.status().as_u16() {
        401 | 403 => return Err(ModelsFailure::Rejected),
        200 => {}
        _ => return Err(ModelsFailure::Unsupported),
    }
    let json = response
        .json::<Value>()
        .await
        .map_err(|_| ModelsFailure::Unsupported)?;
    let mut models = json
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("id")?.as_str().map(str::to_owned))
        .collect::<Vec<_>>();
    models.sort();
    models.dedup();
    if models.is_empty() {
        return Err(ModelsFailure::Unsupported);
    }
    Ok(models)
}

enum ModelsFailure {
    Rejected,
    Transport,
    Unsupported,
}

fn disconnected_status() -> CompatStatus {
    CompatStatus {
        key_present: false,
        connected: false,
        key_rejected: false,
        models: Vec::new(),
        error: None,
    }
}

async fn build_status(def: &'static ProviderDef, key: String) -> CompatStatus {
    match fetch_models(def, &key).await {
        Ok(models) => CompatStatus {
            key_present: true,
            connected: true,
            key_rejected: false,
            models,
            error: None,
        },
        Err(ModelsFailure::Unsupported) => CompatStatus {
            key_present: true,
            connected: true,
            key_rejected: false,
            models: def.default_models.iter().map(|m| m.to_string()).collect(),
            error: None,
        },
        Err(ModelsFailure::Rejected) => CompatStatus {
            key_present: true,
            connected: false,
            key_rejected: true,
            models: Vec::new(),
            error: Some(format!(
                "{} a été refusée par le service. Reconnectez-la.",
                capitalize(def.what)
            )),
        },
        Err(ModelsFailure::Transport) => CompatStatus {
            key_present: true,
            connected: true,
            key_rejected: false,
            models: def.default_models.iter().map(|m| m.to_string()).collect(),
            error: Some("Le service est inaccessible pour le moment.".to_string()),
        },
    }
}

#[tauri::command]
pub async fn compat_status(provider_id: String) -> Result<CompatStatus, String> {
    let def = provider(&provider_id)?;
    // Aucune clé → AUCUN trafic réseau (règle 8.3 : rien ne sort tant que rien n'est connecté).
    let Some(key) = read_secret(def.key_target, def.what)? else {
        return Ok(disconnected_status());
    };
    Ok(build_status(def, key).await)
}

// Un essai de validation par appel de chat à 1 token. Trois issues : validé, refusé
// (définitif — clé en cause), ou échec de CE modèle (candidat suivant possible).
enum ProbeOutcome {
    Valid,
    Rejected(String),
    ModelFailed(String),
}

async fn probe_chat(def: &ProviderDef, key: &str, model: &str) -> Result<ProbeOutcome, String> {
    let response = short_client()
        .post(format!("{}/chat/completions", def.base_url))
        .bearer_auth(key)
        .json(&serde_json::json!({
            "model": model,
            "messages": [{ "role": "user", "content": "ping" }],
            "max_tokens": 1,
            "stream": false,
        }))
        .send()
        .await
        .map_err(|_| {
            "Le service est inaccessible — rien n'a été stocké. Vérifiez votre connexion."
                .to_string()
        })?;
    let status = response.status().as_u16();
    if matches!(status, 401 | 403) {
        return Ok(ProbeOutcome::Rejected(format!(
            "Clé refusée par le service — rien n'a été stocké. Vérifiez {}.",
            def.what
        )));
    }
    let body = response.text().await.unwrap_or_default();
    let json = serde_json::from_str::<Value>(&body).unwrap_or(Value::Null);
    // ⚠ MiniMax répond HTTP 200 même en échec : `base_resp.status_code` fait foi.
    if let Some((code, msg)) = base_resp_error(&json) {
        if is_auth_code(code) {
            return Ok(ProbeOutcome::Rejected(format!(
                "Clé refusée par le service ({msg}) — rien n'a été stocké."
            )));
        }
        return Ok(ProbeOutcome::ModelFailed(msg));
    }
    if (200..300).contains(&status) {
        let has_choice = json
            .get("choices")
            .and_then(Value::as_array)
            .is_some_and(|c| !c.is_empty());
        if has_choice {
            return Ok(ProbeOutcome::Valid);
        }
        return Ok(ProbeOutcome::ModelFailed("réponse sans contenu".to_string()));
    }
    let detail = json
        .pointer("/error/message")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .unwrap_or_else(|| format!("erreur {status}"));
    Ok(ProbeOutcome::ModelFailed(detail))
}

// Valide la clé AVANT de la stocker : clé invalide ou réseau en panne → erreur claire et
// RIEN n'est écrit. Voie rapide : GET /models — un 200 authentifié prouve la clé (et
// donne la liste). Sinon : appel de chat à 1 token, avec repli sur d'autres modèles du
// catalogue (le modèle-sonde en dur ne doit jamais être un point unique de défaillance).
#[tauri::command]
pub async fn compat_set_key(provider_id: String, key: String) -> Result<CompatStatus, String> {
    let def = provider(&provider_id)?;
    let key = key.trim().to_string();
    if key.is_empty() {
        return Err("Collez une clé API.".to_string());
    }
    match fetch_models(def, &key).await {
        Ok(models) => {
            write_secret(def.key_target, &key, def.what)?;
            return Ok(CompatStatus {
                key_present: true,
                connected: true,
                key_rejected: false,
                models,
                error: None,
            });
        }
        Err(ModelsFailure::Rejected) => {
            return Err(format!(
                "Clé refusée par le service — rien n'a été stocké. Vérifiez {}.",
                def.what
            ))
        }
        Err(ModelsFailure::Transport) => {
            return Err(
                "Le service est inaccessible — rien n'a été stocké. Vérifiez votre connexion."
                    .to_string(),
            )
        }
        Err(ModelsFailure::Unsupported) => {} // pas de /models sur cette surface : sonde chat
    }
    let mut candidates = vec![def.probe_model];
    candidates.extend(def.default_models.iter().copied().filter(|m| *m != def.probe_model));
    let mut last_failure = String::new();
    for model in candidates.into_iter().take(3) {
        match probe_chat(def, &key, model).await? {
            ProbeOutcome::Valid => {
                write_secret(def.key_target, &key, def.what)?;
                return Ok(build_status(def, key).await);
            }
            ProbeOutcome::Rejected(message) => return Err(message),
            ProbeOutcome::ModelFailed(detail) => last_failure = detail,
        }
    }
    Err(format!(
        "La validation de la clé a échoué ({last_failure}) — rien n'a été stocké."
    ))
}

#[tauri::command]
pub fn compat_disconnect(provider_id: String) -> Result<(), String> {
    let def = provider(&provider_id)?;
    delete_secret(def.key_target, def.what)
}

#[tauri::command]
pub fn cancel_compat(request_id: String, state: State<'_, CompatState>) {
    if let Some(cancel) = state
        .cancellations
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&request_id)
    {
        let _ = cancel.send(());
    }
}

fn send_event(
    channel: &Channel<CompatStreamEvent>,
    kind: &'static str,
    text: Option<String>,
) -> Result<(), String> {
    channel
        .send(CompatStreamEvent { kind, text })
        .map_err(|error| error.to_string())
}

fn chat_body(_def: &ProviderDef, request: &CompatRequest) -> Value {
    serde_json::json!({
        "model": request.model,
        "messages": request.messages,
        "stream": true,
        // MiniMax M-series : isole la « pensée » dans reasoning_content (qu'on ignore)
        // au lieu de blocs <think> dans le contenu. Ceinture : le scrubber côté front.
        "reasoning_split": true,
    })
}

#[tauri::command]
pub async fn stream_compat(
    request: CompatRequest,
    on_event: Channel<CompatStreamEvent>,
    state: State<'_, CompatState>,
) -> Result<(), String> {
    let def = provider(&request.provider)?;
    let key = read_secret(def.key_target, def.what)?
        .ok_or_else(|| format!("Aucune clé n'est connectée pour ce fournisseur ({}).", def.id))?;
    let request_id = request.request_id.clone();
    let (cancel_tx, mut cancel_rx) = oneshot::channel();
    if let Some(previous) = state
        .cancellations
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(request_id.clone(), cancel_tx)
    {
        let _ = previous.send(());
    }
    let body = chat_body(def, &request);

    let result = async {
        let response = reqwest::Client::new()
            .post(format!("{}/chat/completions", def.base_url))
            .bearer_auth(&key)
            .json(&body)
            .send()
            .await
            .map_err(|_| "Connexion au fournisseur cloud impossible.".to_string())?;
        let status = response.status();
        if !status.is_success() {
            let text = response.text().await.unwrap_or_default();
            return Err(api_error(def, status, &text));
        }

        let mut stream = response.bytes_stream();
        let mut buffer = Vec::<u8>::new();
        let mut completed = false;
        let mut thinking_sent = false;
        loop {
            tokio::select! {
                _ = &mut cancel_rx => break,
                chunk = stream.next() => {
                    let Some(chunk) = chunk else { break };
                    let chunk = chunk.map_err(|_| "Le flux du fournisseur a été interrompu.".to_string())?;
                    buffer.extend_from_slice(&chunk);
                    while let Some((index, delimiter_len)) = find_sse_boundary(&buffer) {
                        let event = buffer[..index].to_vec();
                        buffer.drain(..index + delimiter_len);
                        let json = match parse_sse_event(&event)? {
                            SseEvent::Json(json) => json,
                            SseEvent::Done => {
                                completed = true;
                                send_event(&on_event, "done", None)?;
                                break;
                            }
                            SseEvent::Empty => continue,
                        };
                        if let Some(message) = json.pointer("/error/message").and_then(Value::as_str) {
                            return Err(message.to_string());
                        }
                        // MiniMax : erreur applicative en plein 200 (`base_resp`).
                        if let Some((code, msg)) = base_resp_error(&json) {
                            if is_auth_code(code) {
                                return Err(api_error(def, reqwest::StatusCode::UNAUTHORIZED, ""));
                            }
                            return Err(msg);
                        }
                        // `choices` peut être vide (chunk final d'usage) : accès défensif.
                        if let Some(delta) = json
                            .pointer("/choices/0/delta/content")
                            .and_then(Value::as_str)
                        {
                            if !delta.is_empty() {
                                send_event(&on_event, "delta", Some(delta.to_string()))?;
                            }
                        }
                        // `delta.reasoning_content` (reasoning_split) : le TEXTE reste ignoré,
                        // mais le PREMIER delta signale la phase de réflexion au front — les
                        // M-series pensent longuement avant d'écrire, un statut muet se lirait
                        // comme un blocage (« jamais muet »).
                        if !thinking_sent
                            && json
                                .pointer("/choices/0/delta/reasoning_content")
                                .and_then(Value::as_str)
                                .is_some_and(|s| !s.is_empty())
                        {
                            thinking_sent = true;
                            send_event(&on_event, "thinking", None)?;
                        }
                    }
                    if completed { break; }
                }
            }
        }
        Ok(())
    }
    .await;

    state
        .cancellations
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&request_id);
    if let Err(message) = &result {
        let _ = send_event(&on_event, "error", Some(message.clone()));
    }
    result
}

#[cfg(test)]
mod tests {
    use super::{chat_body, provider, CompatMessage, CompatRequest};

    #[test]
    fn registry_knows_minimax_and_rejects_unknown() {
        let def = provider("minimax").unwrap();
        assert_eq!(def.base_url, "https://api.minimax.io/v1");
        assert!(def.default_models.contains(&"MiniMax-M2.5"));
        assert!(provider("evil").is_err());
    }

    #[test]
    fn chat_body_streams_and_splits_reasoning() {
        let def = provider("minimax").unwrap();
        let body = chat_body(
            def,
            &CompatRequest {
                request_id: "r".into(),
                provider: "minimax".into(),
                model: "MiniMax-M2.5".into(),
                messages: vec![CompatMessage {
                    role: "user".into(),
                    content: "Question".into(),
                }],
            },
        );
        assert_eq!(body["stream"], true);
        assert_eq!(body["reasoning_split"], true);
        assert_eq!(body["messages"][0]["role"], "user");
        assert_eq!(body["model"], "MiniMax-M2.5");
    }
}
