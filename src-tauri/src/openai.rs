use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{ipc::Channel, State};
use tokio::sync::{oneshot, Mutex as AsyncMutex};

const OPENAI_DEVICE_CODE_URL: &str = "https://auth.openai.com/api/accounts/deviceauth/usercode";
const OPENAI_DEVICE_TOKEN_URL: &str = "https://auth.openai.com/api/accounts/deviceauth/token";
const OPENAI_TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
const OPENAI_CODEX_BASE_URL: &str = "https://chatgpt.com/backend-api/codex";
const OPENAI_MODELS_URL: &str = "https://chatgpt.com/backend-api/codex/models?client_version=1.0.0";
const OPENAI_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const PREFERRED_MODEL: &str = "gpt-5.6-luna";
const ACCESS_TOKEN_TARGET: &str = "Doku/OpenAI Codex/access-token";
const REFRESH_TOKEN_TARGET: &str = "Doku/OpenAI Codex/refresh-token";
const DEVICE_CODE_LIFETIME: Duration = Duration::from_secs(15 * 60);

pub struct OpenAiState {
    cancellations: Mutex<HashMap<String, oneshot::Sender<()>>>,
    auth_session: Mutex<Option<DeviceAuthSession>>,
    session_counter: AtomicU64,
    refresh_lock: AsyncMutex<()>,
}

impl Default for OpenAiState {
    fn default() -> Self {
        Self {
            cancellations: Mutex::new(HashMap::new()),
            auth_session: Mutex::new(None),
            session_counter: AtomicU64::new(1),
            refresh_lock: AsyncMutex::new(()),
        }
    }
}

struct DeviceAuthSession {
    id: String,
    device_auth_id: String,
    user_code: String,
    expires_at: Instant,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiStatus {
    authenticated: bool,
    preferred_model: &'static str,
    preferred_model_available: Option<bool>,
    models: Vec<String>,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiAuthStart {
    session_id: String,
    user_code: String,
    verification_url: &'static str,
    expires_in: u64,
    interval: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiAuthPoll {
    status: &'static str,
}

#[derive(Deserialize, Serialize)]
pub struct OpenAiMessage {
    role: String,
    content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiRequest {
    request_id: String,
    model: String,
    input: Vec<OpenAiMessage>,
    reasoning_effort: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiStreamEvent {
    kind: &'static str,
    text: Option<String>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: String,
}

#[cfg(windows)]
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
fn write_secret(target: &str, value: &str) -> Result<(), String> {
    use windows::{
        core::PWSTR,
        Win32::Security::Credentials::{
            CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
        },
    };

    let mut target = wide(target);
    let mut username = wide("Doku");
    let mut blob = value.as_bytes().to_vec();
    let credential = CREDENTIALW {
        Type: CRED_TYPE_GENERIC,
        TargetName: PWSTR(target.as_mut_ptr()),
        CredentialBlobSize: blob.len() as u32,
        CredentialBlob: blob.as_mut_ptr(),
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        UserName: PWSTR(username.as_mut_ptr()),
        ..Default::default()
    };
    unsafe { CredWriteW(&credential, 0) }
        .map_err(|_| "Impossible de protéger la session OpenAI dans Windows.".to_string())
}

#[cfg(windows)]
fn read_secret(target: &str) -> Result<Option<String>, String> {
    use std::{ptr::null_mut, slice};
    use windows::{
        core::{HRESULT, PCWSTR},
        Win32::{
            Foundation::ERROR_NOT_FOUND,
            Security::Credentials::{CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC},
        },
    };

    let target = wide(target);
    let mut raw: *mut CREDENTIALW = null_mut();
    match unsafe { CredReadW(PCWSTR(target.as_ptr()), CRED_TYPE_GENERIC, None, &mut raw) } {
        Ok(()) => {
            if raw.is_null() {
                return Ok(None);
            }
            let credential = unsafe { &*raw };
            let bytes = unsafe {
                slice::from_raw_parts(
                    credential.CredentialBlob,
                    credential.CredentialBlobSize as usize,
                )
            };
            let value = String::from_utf8(bytes.to_vec())
                .map_err(|_| "La session OpenAI protégée est illisible.".to_string());
            unsafe { CredFree(raw.cast()) };
            value.map(Some)
        }
        Err(error) if error.code() == HRESULT::from_win32(ERROR_NOT_FOUND.0) => Ok(None),
        Err(_) => Err("Impossible de lire la session OpenAI protégée.".to_string()),
    }
}

#[cfg(windows)]
fn delete_secret(target: &str) -> Result<(), String> {
    use windows::{
        core::{HRESULT, PCWSTR},
        Win32::{
            Foundation::ERROR_NOT_FOUND,
            Security::Credentials::{CredDeleteW, CRED_TYPE_GENERIC},
        },
    };

    let target = wide(target);
    match unsafe { CredDeleteW(PCWSTR(target.as_ptr()), CRED_TYPE_GENERIC, None) } {
        Ok(()) => Ok(()),
        Err(error) if error.code() == HRESULT::from_win32(ERROR_NOT_FOUND.0) => Ok(()),
        Err(_) => Err("Impossible de supprimer la session OpenAI protégée.".to_string()),
    }
}

#[cfg(not(windows))]
fn write_secret(_target: &str, _value: &str) -> Result<(), String> {
    Err("La connexion OpenAI de Doku est actuellement disponible sous Windows.".to_string())
}

#[cfg(not(windows))]
fn read_secret(_target: &str) -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(not(windows))]
fn delete_secret(_target: &str) -> Result<(), String> {
    Ok(())
}

fn jwt_claims(token: &str) -> Option<Value> {
    let payload = token.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn token_expires_soon(token: &str) -> bool {
    let Some(exp) = jwt_claims(token).and_then(|claims| claims.get("exp").and_then(Value::as_u64))
    else {
        return true;
    };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    exp <= now + 120
}

fn chatgpt_account_id(token: &str) -> Option<String> {
    jwt_claims(token)?
        .pointer("/https:~1~1api.openai.com~1auth/chatgpt_account_id")?
        .as_str()
        .map(str::to_owned)
}

async fn exchange_refresh_token(refresh_token: &str) -> Result<TokenResponse, String> {
    let response = reqwest::Client::new()
        .post(OPENAI_TOKEN_URL)
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", OPENAI_CLIENT_ID),
        ])
        .send()
        .await
        .map_err(|_| "OpenAI est inaccessible pour renouveler la session.".to_string())?;
    if !response.status().is_success() {
        return Err("La session OpenAI a expiré. Reconnectez votre compte.".to_string());
    }
    response
        .json::<TokenResponse>()
        .await
        .map_err(|_| "Réponse de renouvellement OpenAI invalide.".to_string())
}

async fn access_token(state: &OpenAiState, force_refresh: bool) -> Result<String, String> {
    let _guard = state.refresh_lock.lock().await;
    if !force_refresh {
        if let Some(token) = read_secret(ACCESS_TOKEN_TARGET)? {
            if !token_expires_soon(&token) {
                return Ok(token);
            }
        }
    }

    let refresh = read_secret(REFRESH_TOKEN_TARGET)?
        .filter(|token| !token.is_empty())
        .ok_or_else(|| "Aucun compte OpenAI n’est connecté à Doku.".to_string())?;
    let tokens = exchange_refresh_token(&refresh).await?;
    write_secret(ACCESS_TOKEN_TARGET, &tokens.access_token)?;
    if !tokens.refresh_token.is_empty() {
        write_secret(REFRESH_TOKEN_TARGET, &tokens.refresh_token)?;
    }
    Ok(tokens.access_token)
}

async fn fetch_models(token: &str) -> Result<Vec<String>, String> {
    let response = reqwest::Client::new()
        .get(OPENAI_MODELS_URL)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| "Catalogue des modèles OpenAI inaccessible.".to_string())?;
    if !response.status().is_success() {
        return Err("Impossible de vérifier les modèles autorisés par ce compte.".to_string());
    }
    let json = response
        .json::<Value>()
        .await
        .map_err(|_| "Catalogue des modèles OpenAI invalide.".to_string())?;
    let mut models = json
        .get("models")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let visibility = item
                .get("visibility")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if matches!(visibility.to_ascii_lowercase().as_str(), "hide" | "hidden") {
                return None;
            }
            let slug = item.get("slug")?.as_str()?.trim();
            (!slug.is_empty()).then(|| {
                let priority = item
                    .get("priority")
                    .and_then(Value::as_i64)
                    .unwrap_or(10_000);
                (priority, slug.to_string())
            })
        })
        .collect::<Vec<_>>();
    models.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
    models.dedup_by(|a, b| a.1 == b.1);
    Ok(models.into_iter().map(|(_, slug)| slug).collect())
}

#[tauri::command]
pub async fn openai_status(state: State<'_, OpenAiState>) -> Result<OpenAiStatus, String> {
    let stored = read_secret(ACCESS_TOKEN_TARGET).ok().flatten().is_some()
        || read_secret(REFRESH_TOKEN_TARGET).ok().flatten().is_some();
    if !stored {
        return Ok(OpenAiStatus {
            authenticated: false,
            preferred_model: PREFERRED_MODEL,
            preferred_model_available: None,
            models: Vec::new(),
            error: None,
        });
    }

    Ok(match access_token(&state, false).await {
        Ok(token) => match fetch_models(&token).await {
            Ok(models) => OpenAiStatus {
                authenticated: true,
                preferred_model: PREFERRED_MODEL,
                preferred_model_available: Some(
                    models.iter().any(|model| model == PREFERRED_MODEL),
                ),
                models,
                error: None,
            },
            Err(error) => OpenAiStatus {
                authenticated: true,
                preferred_model: PREFERRED_MODEL,
                preferred_model_available: None,
                models: Vec::new(),
                error: Some(error),
            },
        },
        Err(error) => OpenAiStatus {
            authenticated: false,
            preferred_model: PREFERRED_MODEL,
            preferred_model_available: None,
            models: Vec::new(),
            error: Some(error),
        },
    })
}

#[tauri::command]
pub async fn openai_auth_start(state: State<'_, OpenAiState>) -> Result<OpenAiAuthStart, String> {
    let response = reqwest::Client::new()
        .post(OPENAI_DEVICE_CODE_URL)
        .json(&serde_json::json!({ "client_id": OPENAI_CLIENT_ID }))
        .send()
        .await
        .map_err(|_| "Impossible de démarrer la connexion avec OpenAI.".to_string())?;
    if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err(
            "Trop de tentatives de connexion. Patientez un instant puis réessayez.".to_string(),
        );
    }
    if !response.status().is_success() {
        return Err("OpenAI a refusé le démarrage de la connexion.".to_string());
    }
    let json = response
        .json::<Value>()
        .await
        .map_err(|_| "Réponse de connexion OpenAI invalide.".to_string())?;
    let user_code = json
        .get("user_code")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "OpenAI n’a pas fourni de code de connexion.".to_string())?
        .to_string();
    let device_auth_id = json
        .get("device_auth_id")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "OpenAI n’a pas fourni de session de connexion.".to_string())?
        .to_string();
    let interval = json
        .get("interval")
        .and_then(|value| {
            value
                .as_u64()
                .or_else(|| value.as_str().and_then(|raw| raw.parse().ok()))
        })
        .unwrap_or(5)
        .max(3);
    let counter = state.session_counter.fetch_add(1, Ordering::Relaxed);
    let session_id = format!("openai-{counter}");
    *state.auth_session.lock().expect("openai auth session lock") = Some(DeviceAuthSession {
        id: session_id.clone(),
        device_auth_id,
        user_code: user_code.clone(),
        expires_at: Instant::now() + DEVICE_CODE_LIFETIME,
    });

    Ok(OpenAiAuthStart {
        session_id,
        user_code,
        verification_url: "https://auth.openai.com/codex/device",
        expires_in: DEVICE_CODE_LIFETIME.as_secs(),
        interval,
    })
}

#[tauri::command]
pub async fn openai_auth_poll(
    session_id: String,
    state: State<'_, OpenAiState>,
) -> Result<OpenAiAuthPoll, String> {
    let (device_auth_id, user_code) = {
        let mut session = state.auth_session.lock().expect("openai auth session lock");
        let Some(current) = session.as_ref() else {
            return Ok(OpenAiAuthPoll { status: "expired" });
        };
        if current.id != session_id {
            return Ok(OpenAiAuthPoll { status: "expired" });
        }
        if Instant::now() >= current.expires_at {
            *session = None;
            return Ok(OpenAiAuthPoll { status: "expired" });
        }
        (current.device_auth_id.clone(), current.user_code.clone())
    };

    let response = reqwest::Client::new()
        .post(OPENAI_DEVICE_TOKEN_URL)
        .json(&serde_json::json!({
            "device_auth_id": device_auth_id,
            "user_code": user_code,
        }))
        .send()
        .await
        .map_err(|_| "Impossible de vérifier la connexion OpenAI.".to_string())?;
    if matches!(response.status().as_u16(), 403 | 404) {
        return Ok(OpenAiAuthPoll { status: "pending" });
    }
    if !response.status().is_success() {
        return Err("OpenAI a interrompu la connexion. Recommencez.".to_string());
    }
    let code = response
        .json::<Value>()
        .await
        .map_err(|_| "Validation OpenAI invalide.".to_string())?;
    let authorization_code = code
        .get("authorization_code")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Validation OpenAI incomplète.".to_string())?;
    let code_verifier = code
        .get("code_verifier")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Validation OpenAI incomplète.".to_string())?;
    let token_response = reqwest::Client::new()
        .post(OPENAI_TOKEN_URL)
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", authorization_code),
            (
                "redirect_uri",
                "https://auth.openai.com/deviceauth/callback",
            ),
            ("client_id", OPENAI_CLIENT_ID),
            ("code_verifier", code_verifier),
        ])
        .send()
        .await
        .map_err(|_| "Impossible de finaliser la connexion OpenAI.".to_string())?;
    if !token_response.status().is_success() {
        return Err("OpenAI n’a pas pu finaliser la connexion.".to_string());
    }
    let tokens = token_response
        .json::<TokenResponse>()
        .await
        .map_err(|_| "Jetons de connexion OpenAI invalides.".to_string())?;
    if tokens.access_token.is_empty() {
        return Err("OpenAI n’a pas fourni de session utilisable.".to_string());
    }
    write_secret(ACCESS_TOKEN_TARGET, &tokens.access_token)?;
    if !tokens.refresh_token.is_empty() {
        write_secret(REFRESH_TOKEN_TARGET, &tokens.refresh_token)?;
    }
    *state.auth_session.lock().expect("openai auth session lock") = None;
    Ok(OpenAiAuthPoll { status: "approved" })
}

#[tauri::command]
pub fn openai_auth_cancel(session_id: String, state: State<'_, OpenAiState>) {
    let mut session = state.auth_session.lock().expect("openai auth session lock");
    if session
        .as_ref()
        .is_some_and(|current| current.id == session_id)
    {
        *session = None;
    }
}

#[tauri::command]
pub fn openai_disconnect(state: State<'_, OpenAiState>) -> Result<(), String> {
    *state.auth_session.lock().expect("openai auth session lock") = None;
    delete_secret(ACCESS_TOKEN_TARGET)?;
    delete_secret(REFRESH_TOKEN_TARGET)
}

#[tauri::command]
pub fn cancel_openai(request_id: String, state: State<'_, OpenAiState>) {
    if let Some(cancel) = state
        .cancellations
        .lock()
        .expect("openai cancellations lock")
        .remove(&request_id)
    {
        let _ = cancel.send(());
    }
}

fn send_event(
    channel: &Channel<OpenAiStreamEvent>,
    kind: &'static str,
    text: Option<String>,
) -> Result<(), String> {
    channel
        .send(OpenAiStreamEvent { kind, text })
        .map_err(|error| error.to_string())
}

fn find_sse_boundary(bytes: &[u8]) -> Option<(usize, usize)> {
    let lf = bytes
        .windows(2)
        .position(|window| window == b"\n\n")
        .map(|index| (index, 2));
    let crlf = bytes
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|index| (index, 4));
    match (lf, crlf) {
        (Some(a), Some(b)) => Some(if a.0 <= b.0 { a } else { b }),
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        (None, None) => None,
    }
}

fn parse_sse_event(bytes: &[u8]) -> Result<Option<Value>, String> {
    let event =
        std::str::from_utf8(bytes).map_err(|_| "Flux OpenAI invalide (UTF-8).".to_string())?;
    let data = event
        .lines()
        .filter_map(|line| line.strip_prefix("data:"))
        .map(str::trim_start)
        .collect::<Vec<_>>()
        .join("\n");
    if data.is_empty() || data == "[DONE]" {
        return Ok(None);
    }
    serde_json::from_str(&data)
        .map(Some)
        .map_err(|_| "Événement OpenAI invalide.".to_string())
}

fn api_error(status: reqwest::StatusCode, body: &str) -> String {
    let detail = serde_json::from_str::<Value>(body).ok().and_then(|json| {
        json.pointer("/error/message")
            .and_then(Value::as_str)
            .map(str::to_owned)
    });
    match status.as_u16() {
        401 => "La session OpenAI n’est plus valide. Reconnectez votre compte.".to_string(),
        429 => detail.unwrap_or_else(|| "Limite d’utilisation OpenAI atteinte.".to_string()),
        _ => detail.unwrap_or_else(|| format!("OpenAI a répondu avec l’erreur {status}.")),
    }
}

fn response_body(request: &OpenAiRequest) -> Value {
    let instructions = request
        .input
        .iter()
        .filter(|message| matches!(message.role.as_str(), "system" | "developer"))
        .map(|message| message.content.trim())
        .filter(|content| !content.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    let input = request
        .input
        .iter()
        .filter(|message| matches!(message.role.as_str(), "user" | "assistant"))
        .map(|message| {
            serde_json::json!({
                "role": message.role,
                "content": message.content,
            })
        })
        .collect::<Vec<_>>();
    let mut body = serde_json::json!({
        "model": request.model,
        "instructions": if instructions.is_empty() { "Tu es Doku-San, un assistant documentaire précis et concis." } else { &instructions },
        "input": input,
        "stream": true,
        "store": false,
    });
    if let Some(effort) = request.reasoning_effort.as_deref() {
        body["reasoning"] = serde_json::json!({ "effort": effort, "summary": "auto" });
        body["include"] = serde_json::json!(["reasoning.encrypted_content"]);
    } else {
        body["include"] = serde_json::json!([]);
    }
    body
}

async fn send_codex_request(
    token: &str,
    request_id: &str,
    body: &Value,
) -> Result<reqwest::Response, String> {
    let mut request = reqwest::Client::new()
        .post(format!("{OPENAI_CODEX_BASE_URL}/responses"))
        .bearer_auth(token)
        .header("User-Agent", "codex_cli_rs/0.0.0 (Doku)")
        .header("originator", "codex_cli_rs")
        .header("session_id", request_id)
        .header("x-client-request-id", request_id)
        .json(body);
    if let Some(account_id) = chatgpt_account_id(token) {
        request = request.header("ChatGPT-Account-ID", account_id);
    }
    request
        .send()
        .await
        .map_err(|_| "Connexion à OpenAI impossible.".to_string())
}

#[tauri::command]
pub async fn stream_openai(
    request: OpenAiRequest,
    on_event: Channel<OpenAiStreamEvent>,
    state: State<'_, OpenAiState>,
) -> Result<(), String> {
    if request.model != PREFERRED_MODEL {
        return Err("Le modèle OpenAI demandé n’est pas autorisé par Doku.".to_string());
    }
    let request_id = request.request_id.clone();
    let (cancel_tx, mut cancel_rx) = oneshot::channel();
    if let Some(previous) = state
        .cancellations
        .lock()
        .expect("openai cancellations lock")
        .insert(request_id.clone(), cancel_tx)
    {
        let _ = previous.send(());
    }
    let body = response_body(&request);

    let result = async {
        let mut token = access_token(&state, false).await?;
        let mut response = send_codex_request(&token, &request_id, &body).await?;
        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            token = access_token(&state, true).await?;
            response = send_codex_request(&token, &request_id, &body).await?;
        }
        let status = response.status();
        if !status.is_success() {
            let text = response.text().await.unwrap_or_default();
            return Err(api_error(status, &text));
        }

        let mut stream = response.bytes_stream();
        let mut buffer = Vec::<u8>::new();
        let mut completed = false;
        loop {
            tokio::select! {
                _ = &mut cancel_rx => break,
                chunk = stream.next() => {
                    let Some(chunk) = chunk else { break };
                    let chunk = chunk.map_err(|_| "Le flux OpenAI a été interrompu.".to_string())?;
                    buffer.extend_from_slice(&chunk);
                    while let Some((index, delimiter_len)) = find_sse_boundary(&buffer) {
                        let event = buffer[..index].to_vec();
                        buffer.drain(..index + delimiter_len);
                        let Some(json) = parse_sse_event(&event)? else { continue };
                        match json.get("type").and_then(Value::as_str) {
                            Some("response.output_text.delta") => {
                                if let Some(delta) = json.get("delta").and_then(Value::as_str) {
                                    send_event(&on_event, "delta", Some(delta.to_string()))?;
                                }
                            }
                            Some("response.completed") => {
                                completed = true;
                                send_event(&on_event, "done", None)?;
                                break;
                            }
                            Some("response.failed") | Some("error") => {
                                let message = json
                                    .pointer("/response/error/message")
                                    .or_else(|| json.pointer("/error/message"))
                                    .and_then(Value::as_str)
                                    .unwrap_or("La génération OpenAI a échoué.");
                                return Err(message.to_string());
                            }
                            _ => {}
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
        .expect("openai cancellations lock")
        .remove(&request_id);
    if let Err(message) = &result {
        let _ = send_event(&on_event, "error", Some(message.clone()));
    }
    result
}

#[cfg(test)]
mod tests {
    use super::{
        chatgpt_account_id, find_sse_boundary, parse_sse_event, response_body, token_expires_soon,
        OpenAiMessage, OpenAiRequest,
    };
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn jwt(claims: serde_json::Value) -> String {
        format!("x.{}.x", URL_SAFE_NO_PAD.encode(claims.to_string()))
    }

    #[test]
    fn parses_delta_event() {
        let event = b"event: response.output_text.delta\r\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"Salut\"}";
        let json = parse_sse_event(event).unwrap().unwrap();
        assert_eq!(json["delta"], "Salut");
    }

    #[test]
    fn recognizes_lf_and_crlf_boundaries() {
        assert_eq!(find_sse_boundary(b"a\n\nb"), Some((1, 2)));
        assert_eq!(find_sse_boundary(b"a\r\n\r\nb"), Some((1, 4)));
    }

    #[test]
    fn extracts_chatgpt_account_id() {
        let token = jwt(serde_json::json!({
            "https://api.openai.com/auth": { "chatgpt_account_id": "acct_123" }
        }));
        assert_eq!(chatgpt_account_id(&token).as_deref(), Some("acct_123"));
    }

    #[test]
    fn recognizes_a_fresh_token() {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        assert!(!token_expires_soon(&jwt(
            serde_json::json!({ "exp": now + 3600 })
        )));
        assert!(token_expires_soon(&jwt(
            serde_json::json!({ "exp": now + 30 })
        )));
    }

    #[test]
    fn separates_instructions_from_conversation_input() {
        let body = response_body(&OpenAiRequest {
            request_id: "r".into(),
            model: "gpt-5.6-luna".into(),
            input: vec![
                OpenAiMessage {
                    role: "system".into(),
                    content: "Cadre".into(),
                },
                OpenAiMessage {
                    role: "user".into(),
                    content: "Question".into(),
                },
            ],
            reasoning_effort: Some("low".into()),
        });
        assert_eq!(body["instructions"], "Cadre");
        assert_eq!(body["input"][0]["role"], "user");
        assert_eq!(body["store"], false);
        assert!(body.get("max_output_tokens").is_none());
    }

}
