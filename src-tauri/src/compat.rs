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

// Client de STREAMING, sans timeout global (une génération peut durer des minutes) mais
// PARTAGÉ : `reqwest::Client::new()` par requête reconstruit pool de connexions ET
// configuration TLS, donc une poignée de main neuve à chaque message. Le rappel mémoire
// et la question de l'utilisateur en font trois par tour.
fn stream_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(reqwest::Client::new)
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
    /// Le fournisseur comprend `thinking: {"type": …}`. Chez MiniMax, seul **M3** le
    /// respecte : les M2.x ignorent `"disabled"` et réfléchissent quand même (documenté
    /// chez eux). L'envoyer reste donc sans effet, jamais une erreur.
    thinking_param: bool,
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
    thinking_param: true,
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

/// Un tour de conversation tel qu'il part au fournisseur. `tool_calls` (réponse du modèle)
/// et `tool_call_id` (résultat qu'on lui rend) ne sont sérialisés que lorsqu'ils existent :
/// l'API refuse un `tool_calls: null` sur un message ordinaire.
#[derive(Deserialize, Serialize)]
pub struct CompatMessage {
    role: String,
    content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    tool_calls: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    tool_call_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompatRequest {
    request_id: String,
    provider: String,
    model: String,
    messages: Vec<CompatMessage>,
    /// Plafond de tokens de sortie pour les appels INTERNES (sélection mémoire, map de
    /// résumé) dont la sortie utile tient en quelques lignes. Absent = conversation.
    max_output_tokens: Option<u32>,
    /// Outils déclarés au modèle, au format OpenAI. Le frontend les exécute et relance —
    /// l'hôte ne fait que transporter (ADR-0004).
    #[serde(default)]
    tools: Option<Value>,
    /// Réflexion demandée par l'utilisateur (bouton « Réfléchir ») : on ne coupe plus la
    /// pensée des modèles qui acceptent de la couper. Absent = appel ordinaire, bridé.
    #[serde(default)]
    thinking: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CompatStreamEvent {
    kind: &'static str,
    text: Option<String>,
}

// Pourquoi ce détail : chaque appel réseau faisait `map_err(|_| …)`, donc la cause était
// JETÉE à l'endroit précis où elle compte. Un utilisateur voyait « Le service est
// inaccessible » sans jamais savoir si c'était le DNS, le pare-feu, un certificat ou un
// délai — et nous non plus, donc impossible de l'aider à distance. Vécu sur Arch, où la
// même phrase pouvait couvrir quatre pannes différentes.
//
// La clé API ne peut pas fuir ici : reqwest ne met pas les en-têtes dans ses erreurs.
fn transport_reason(error: &reqwest::Error) -> String {
    let genre = if error.is_timeout() {
        "délai dépassé"
    } else if error.is_connect() {
        "connexion impossible"
    } else if error.is_request() {
        "requête invalide"
    } else {
        "erreur réseau"
    };
    // La cause la plus PROFONDE est la plus parlante : « dns error … », « certificate
    // verify failed », « connection refused »…
    let mut cause: &dyn std::error::Error = error;
    while let Some(source) = cause.source() {
        cause = source;
    }
    format!("{genre} : {cause}")
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
        .map_err(|error| ModelsFailure::Transport(transport_reason(&error)))?;
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
    /// Porte la RAISON, pas seulement le fait : c'est elle qui permet d'aider à distance.
    Transport(String),
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
        Err(ModelsFailure::Transport(raison)) => CompatStatus {
            key_present: true,
            connected: true,
            key_rejected: false,
            models: def.default_models.iter().map(|m| m.to_string()).collect(),
            error: Some(format!("Le service est inaccessible pour le moment ({raison}).")),
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
        .map_err(|error| {
            format!(
                "Le service est inaccessible — rien n'a été stocké ({}).",
                transport_reason(&error)
            )
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
    let mut models_transport: Option<String> = None;
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
        // `GET /models` est FACULTATIF — le commentaire de `fetch_models` le dit :
        // MiniMax ne le documente pas. Son échec de TRANSPORT ne prouve donc rien, ni sur
        // la clé ni sur le service : certaines surfaces coupent la connexion au lieu de
        // rendre un 404 propre, et abandonner ici revient à refuser une clé parfaitement
        // valide à cause d'un point d'entrée dont on sait déjà se passer. Vécu : le même
        // abonnement MiniMax fonctionnait dans un autre outil sur la MÊME machine.
        //
        // Règle : seul l'échec de la sonde AUTORITAIRE (l'appel de chat) peut conclure.
        // On garde la raison au cas où celle-ci échouerait aussi — elle dira alors si les
        // deux points d'entrée butent sur la même cause.
        Err(ModelsFailure::Transport(raison)) => models_transport = Some(raison),
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
    // Les DEUX points d'entrée ont échoué : la raison réseau du premier redevient utile,
    // elle situe la panne au lieu de la nommer une seconde fois.
    Err(match models_transport {
        Some(raison) => format!(
            "La validation de la clé a échoué ({last_failure}) — rien n'a été stocké. Le catalogue des modèles était lui aussi injoignable ({raison})."
        ),
        None => format!("La validation de la clé a échoué ({last_failure}) — rien n'a été stocké."),
    })
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

/// Un appel d'outil en cours de reconstitution. Le fournisseur ne l'envoie PAS d'un bloc :
/// `id` et `function.name` arrivent au premier fragment, puis `function.arguments` tombe
/// par morceaux de JSON qui ne sont valides qu'une fois recollés. `index` identifie
/// l'appel quand le modèle en demande plusieurs à la fois.
#[derive(Default)]
struct PendingToolCall {
    id: String,
    name: String,
    arguments: String,
}

fn absorb_tool_call_deltas(json: &Value, pending: &mut Vec<PendingToolCall>) {
    let Some(calls) = json
        .pointer("/choices/0/delta/tool_calls")
        .and_then(Value::as_array)
    else {
        return;
    };
    for call in calls {
        let index = call.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
        if pending.len() <= index {
            pending.resize_with(index + 1, PendingToolCall::default);
        }
        let slot = &mut pending[index];
        if let Some(id) = call.get("id").and_then(Value::as_str) {
            if !id.is_empty() {
                slot.id = id.to_string();
            }
        }
        if let Some(name) = call.pointer("/function/name").and_then(Value::as_str) {
            slot.name.push_str(name);
        }
        if let Some(arguments) = call.pointer("/function/arguments").and_then(Value::as_str) {
            slot.arguments.push_str(arguments);
        }
    }
}

fn tool_calls_payload(pending: &[PendingToolCall]) -> Option<String> {
    let calls = pending
        .iter()
        .filter(|call| !call.name.is_empty())
        .map(|call| {
            serde_json::json!({
                "id": call.id,
                "name": call.name,
                "arguments": call.arguments,
            })
        })
        .collect::<Vec<_>>();
    if calls.is_empty() {
        return None;
    }
    serde_json::to_string(&calls).ok()
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

// Seuls les M3 honorent `thinking`. La doc MiniMax dit que les M2.x l'IGNORENT, mais
// « ignoré d’après la doc » ne vaut pas « accepté par le service » : le paramètre ne
// leur servirait à rien de toute façon, donc on ne l’envoie qu’aux modèles où il agit.
// Le risque de casser un M2.x passe ainsi de faible à nul.
fn honors_thinking(model: &str) -> bool {
    model.contains("M3")
}

fn chat_body(def: &ProviderDef, request: &CompatRequest) -> Value {
    let mut body = serde_json::json!({
        "model": request.model,
        "messages": request.messages,
        "stream": true,
        // MiniMax M-series : isole la « pensée » dans reasoning_content (qu'on ignore)
        // au lieu de blocs <think> dans le contenu. Ceinture : le scrubber côté front.
        // ⚠ `reasoning_split` ne COUPE rien — il ne fait que déplacer la pensée hors du
        // contenu. Le modèle réfléchit autant ; on ne le voit simplement plus.
        "reasoning_split": true,
    });
    if def.thinking_param && honors_thinking(&request.model) && !request.thinking {
        // Le pendant du `reasoning: {effort: "low"}` envoyé à OpenAI : sans lui, la
        // surface compatible réfléchissait à pleine profondeur pendant que l'autre
        // fournisseur était bridé — d'où « MiniMax est lent, OpenAI est rapide », qui
        // était une asymétrie de Doku, pas des fournisseurs.
        body["thinking"] = serde_json::json!({ "type": "disabled" });
    }
    if let Some(tools) = &request.tools {
        body["tools"] = tools.clone();
        body["tool_choice"] = serde_json::json!("auto");
    }
    if let Some(max) = request.max_output_tokens {
        body["max_completion_tokens"] = serde_json::json!(max);
    }
    body
}

// Échec d'une tentative de flux. `retryable` = panne passagère (surcharge, coupure réseau,
// flux tronqué, limite de débit) qu'une nouvelle tentative règle, par opposition à une clé
// refusée ou une requête invalide qui échoueraient à l'identique.
struct StreamFailure {
    message: String,
    retryable: bool,
}

impl StreamFailure {
    fn transient(message: impl Into<String>) -> Self {
        Self { message: message.into(), retryable: true }
    }
    fn fatal(message: impl Into<String>) -> Self {
        Self { message: message.into(), retryable: false }
    }
}

// Deux relances (0,8 s puis 2,4 s) : MiniMax renvoie par intermittence une surcharge ou coupe
// le flux pendant la réflexion. Sans relance, chaque panne passagère devenait une carte
// « La génération a échoué » à relancer à la main.
const MAX_STREAM_RETRIES: u32 = 2;

fn retryable_status(status: u16) -> bool {
    matches!(status, 408 | 429 | 500 | 502 | 503 | 504 | 529)
}

// Codes `base_resp` passagers de MiniMax : erreur inconnue, délai dépassé, limites de débit
// (requêtes, tokens, connexions, croissance), erreur interne ou système.
fn is_transient_code(code: i64) -> bool {
    matches!(code, 1000 | 1001 | 1002 | 1024 | 1033 | 1039 | 1041 | 2045)
}

// Erreur envoyée DANS le flux (`{"error": {...}}`) : passagère si elle porte un statut HTTP
// de surcharge ou un type « serveur ».
fn transient_stream_error(json: &Value) -> bool {
    let http = json
        .pointer("/error/http_code")
        .and_then(|value| value.as_u64().or_else(|| value.as_str()?.parse().ok()));
    let kind = json.pointer("/error/type").and_then(Value::as_str).unwrap_or("");
    http.is_some_and(|code| u16::try_from(code).is_ok_and(retryable_status))
        || matches!(kind, "overloaded_error" | "api_error" | "rate_limit_error" | "server_error")
}

// Une tentative complète. `visible` passe à vrai dès qu'un texte ou un appel d'outil est parti
// vers le frontend : au-delà, relancer dupliquerait la réponse, l'erreur remonte telle quelle.
async fn stream_attempt(
    def: &ProviderDef,
    key: &str,
    body: &Value,
    on_event: &Channel<CompatStreamEvent>,
    cancel_rx: &mut oneshot::Receiver<()>,
    visible: &mut bool,
) -> Result<(), StreamFailure> {
    let response = stream_client()
        .post(format!("{}/chat/completions", def.base_url))
        .bearer_auth(key)
        .json(body)
        .send()
        .await
        .map_err(|error| {
            StreamFailure::transient(format!(
                "Connexion au fournisseur cloud impossible ({}).",
                transport_reason(&error)
            ))
        })?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(StreamFailure {
            message: api_error(def, status, &text),
            retryable: retryable_status(status.as_u16()),
        });
    }

    let event = |kind: &'static str, text: Option<String>| {
        send_event(on_event, kind, text).map_err(StreamFailure::fatal)
    };
    let mut stream = response.bytes_stream();
    let mut buffer = Vec::<u8>::new();
    let mut thinking_sent = false;
    let mut pending_tool_calls: Vec<PendingToolCall> = Vec::new();
    loop {
        tokio::select! {
            _ = &mut *cancel_rx => return Ok(()),
            chunk = stream.next() => {
                let Some(chunk) = chunk else { break };
                let chunk = chunk.map_err(|_| StreamFailure::transient("Le flux du fournisseur a été interrompu."))?;
                buffer.extend_from_slice(&chunk);
                while let Some((index, delimiter_len)) = find_sse_boundary(&buffer) {
                    let raw = buffer[..index].to_vec();
                    buffer.drain(..index + delimiter_len);
                    let json = match parse_sse_event(&raw).map_err(StreamFailure::transient)? {
                        SseEvent::Json(json) => json,
                        SseEvent::Done => return finish(&event, &pending_tool_calls, visible),
                        SseEvent::Empty => continue,
                    };
                    if let Some(message) = json.pointer("/error/message").and_then(Value::as_str) {
                        return Err(StreamFailure {
                            message: message.to_string(),
                            retryable: transient_stream_error(&json),
                        });
                    }
                    // MiniMax : erreur applicative en plein 200 (`base_resp`).
                    if let Some((code, msg)) = base_resp_error(&json) {
                        if is_auth_code(code) {
                            return Err(StreamFailure::fatal(api_error(def, reqwest::StatusCode::UNAUTHORIZED, "")));
                        }
                        return Err(StreamFailure { message: msg, retryable: is_transient_code(code) });
                    }
                    // `choices` peut être vide (chunk final d'usage) : accès défensif.
                    if let Some(delta) = json
                        .pointer("/choices/0/delta/content")
                        .and_then(Value::as_str)
                    {
                        if !delta.is_empty() {
                            *visible = true;
                            event("delta", Some(delta.to_string()))?;
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
                        event("thinking", None)?;
                    }
                    absorb_tool_call_deltas(&json, &mut pending_tool_calls);
                }
            }
        }
    }
    // Flux clos sans `[DONE]` : les appels reconstitués seraient perdus alors qu'ils sont
    // complets. Le repli n'est pas théorique — un fournisseur peut fermer la connexion sur
    // le dernier chunk.
    finish(&event, &pending_tool_calls, visible)
}

// Fin de flux. Les appels d'outils partent AVANT `done` : le frontend doit savoir qu'il a des
// recherches à exécuter au moment où il apprend que le tour est terminé. Un flux terminé sans
// texte ni outil (toute la réponse partie en réflexion) est une panne passagère.
fn finish(
    event: &impl Fn(&'static str, Option<String>) -> Result<(), StreamFailure>,
    pending_tool_calls: &[PendingToolCall],
    visible: &mut bool,
) -> Result<(), StreamFailure> {
    if let Some(payload) = tool_calls_payload(pending_tool_calls) {
        *visible = true;
        event("toolCalls", Some(payload))?;
    }
    if !*visible {
        return Err(StreamFailure::transient("Le modèle n’a renvoyé aucun texte de réponse."));
    }
    event("done", None)
}

// Relance les pannes passagères tant que rien n'est encore affiché (voir StreamFailure).
async fn stream_with_retries(
    def: &ProviderDef,
    key: &str,
    body: &Value,
    on_event: &Channel<CompatStreamEvent>,
    cancel_rx: &mut oneshot::Receiver<()>,
) -> Result<(), String> {
    let mut attempt = 0;
    loop {
        let mut visible = false;
        match stream_attempt(def, key, body, on_event, cancel_rx, &mut visible).await {
            Ok(()) => break Ok(()),
            Err(failure) if failure.retryable && !visible && attempt < MAX_STREAM_RETRIES => {
                attempt += 1;
                log::warn!("{} : tentative {attempt} échouée, nouvel essai — {}", def.id, failure.message);
                // Attente croissante, annulable : « Arrêter » n'attend pas la fin du délai.
                tokio::select! {
                    _ = &mut *cancel_rx => break Ok(()),
                    _ = tokio::time::sleep(Duration::from_millis(800 * 3u64.pow(attempt - 1))) => {}
                }
            }
            Err(failure) => {
                log::error!("{} : génération échouée après {} tentative(s) — {}", def.id, attempt + 1, failure.message);
                break Err(failure.message);
            }
        }
    }
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

    let result = stream_with_retries(def, &key, &body, &on_event, &mut cancel_rx).await;

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
    use super::{
        absorb_tool_call_deltas, chat_body, is_transient_code, provider, retryable_status,
        tool_calls_payload, transient_stream_error, CompatMessage, CompatRequest, Value,
    };

    #[test]
    fn retries_only_passing_failures() {
        // Surcharge, limite de débit, panne serveur : une relance a une chance.
        for status in [429, 500, 502, 503, 504, 529] {
            assert!(retryable_status(status), "{status}");
        }
        // Clé refusée, requête invalide : échouerait pareil.
        for status in [400, 401, 403, 404, 422] {
            assert!(!retryable_status(status), "{status}");
        }
        assert!(is_transient_code(1002) && is_transient_code(1033));
        assert!(!is_transient_code(1004) && !is_transient_code(2013) && !is_transient_code(1026));
        let overloaded: Value = serde_json::json!({ "error": { "type": "overloaded_error", "message": "busy" } });
        let busy: Value = serde_json::json!({ "error": { "http_code": "529", "message": "high load" } });
        let invalid: Value = serde_json::json!({ "error": { "type": "invalid_request_error", "http_code": "400", "message": "bad" } });
        assert!(transient_stream_error(&overloaded));
        assert!(transient_stream_error(&busy));
        assert!(!transient_stream_error(&invalid));
    }

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
                    tool_calls: None,
                    tool_call_id: None,
                }],
                max_output_tokens: None,
                tools: None,
                thinking: false,
            },
        );
        assert_eq!(body["stream"], true);
        assert_eq!(body["reasoning_split"], true);
        assert_eq!(body["messages"][0]["role"], "user");
        assert_eq!(body["model"], "MiniMax-M2.5");
        // Un M2.x ne reçoit PAS `thinking` : il ne l'honore pas, on ne le lui envoie pas.
        assert!(body.get("thinking").is_none());
        // Conversation = pas de plafond : le champ ne doit pas apparaître.
        assert!(body.get("max_completion_tokens").is_none());
    }

    #[test]
    fn chat_body_disables_thinking_on_m3() {
        let def = provider("minimax").unwrap();
        let body = chat_body(
            def,
            &CompatRequest {
                request_id: "r".into(),
                provider: "minimax".into(),
                model: "MiniMax-M3".into(),
                messages: vec![CompatMessage {
                    role: "user".into(),
                    content: "Question".into(),
                    tool_calls: None,
                    tool_call_id: None,
                }],
                max_output_tokens: None,
                tools: None,
                thinking: false,
            },
        );
        // Le pendant du `reasoning: {effort: "low"}` d'OpenAI. Sans lui, M3 réfléchissait
        // à pleine profondeur sur CHACUN des appels d'un tour.
        assert_eq!(body["thinking"]["type"], "disabled");
    }

    #[test]
    fn chat_body_lets_m3_think_on_request() {
        let def = provider("minimax").unwrap();
        let body = chat_body(
            def,
            &CompatRequest {
                request_id: "r".into(),
                provider: "minimax".into(),
                model: "MiniMax-M3".into(),
                messages: vec![],
                max_output_tokens: None,
                tools: None,
                thinking: true,
            },
        );
        // Bouton « Réfléchir » : la pensée n'est plus coupée, le modèle garde son défaut.
        assert!(body.get("thinking").is_none());
    }

    #[test]
    fn chat_body_caps_internal_calls() {
        let def = provider("minimax").unwrap();
        let body = chat_body(
            def,
            &CompatRequest {
                request_id: "r".into(),
                provider: "minimax".into(),
                model: "MiniMax-M3".into(),
                messages: vec![CompatMessage {
                    role: "user".into(),
                    content: "Choisis les souvenirs utiles".into(),
                    tool_calls: None,
                    tool_call_id: None,
                }],
                max_output_tokens: Some(512),
                tools: None,
                thinking: false,
            },
        );
        assert_eq!(body["max_completion_tokens"], 512);
    }

    // Le fournisseur n'envoie PAS l'appel d'outil d'un bloc : `id` et `name` au premier
    // fragment, puis les arguments par morceaux de JSON invalides pris isolément. Recoller
    // avant de tenter le décodage est la seule façon d'obtenir la requête du modèle.
    #[test]
    fn reassembles_tool_calls_streamed_in_fragments() {
        let mut pending = Vec::new();
        for chunk in [
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","function":{"name":"web_search","arguments":"{\"que"}}]}}]}"#,
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ry\":\"Adobe ETLA\"}"}}]}}]}"#,
        ] {
            absorb_tool_call_deltas(&serde_json::from_str(chunk).unwrap(), &mut pending);
        }
        let payload = tool_calls_payload(&pending).expect("un appel doit être reconstitué");
        let parsed: Value = serde_json::from_str(&payload).unwrap();
        assert_eq!(parsed[0]["id"], "call_a");
        assert_eq!(parsed[0]["name"], "web_search");
        assert_eq!(parsed[0]["arguments"], r#"{"query":"Adobe ETLA"}"#);
    }

    // Le modèle peut demander plusieurs recherches d'un coup : `index` est ce qui les
    // distingue, et les mélanger produirait deux requêtes corrompues.
    #[test]
    fn keeps_parallel_tool_calls_apart() {
        let mut pending = Vec::new();
        absorb_tool_call_deltas(
            &serde_json::from_str(
                r#"{"choices":[{"delta":{"tool_calls":[
                    {"index":0,"id":"a","function":{"name":"web_search","arguments":"{\"query\":\"un\"}"}},
                    {"index":1,"id":"b","function":{"name":"web_search","arguments":"{\"query\":\"deux\"}"}}
                ]}}]}"#,
            )
            .unwrap(),
            &mut pending,
        );
        let parsed: Value = serde_json::from_str(&tool_calls_payload(&pending).unwrap()).unwrap();
        assert_eq!(parsed.as_array().unwrap().len(), 2);
        assert_eq!(parsed[1]["arguments"], r#"{"query":"deux"}"#);
    }

    #[test]
    fn emits_nothing_without_a_tool_call() {
        assert!(tool_calls_payload(&[]).is_none());
    }

    #[test]
    fn declares_tools_only_when_asked() {
        let with_tools = chat_body(
            provider("minimax").unwrap(),
            &CompatRequest {
                request_id: "r".into(),
                provider: "minimax".into(),
                model: "MiniMax-M2.5".into(),
                messages: vec![],
                max_output_tokens: None,
                tools: Some(serde_json::json!([{ "type": "function" }])),
                thinking: false,
            },
        );
        assert_eq!(with_tools["tool_choice"], "auto");
        assert_eq!(with_tools["tools"][0]["type"], "function");
    }

    // --- Relances du flux, contre un faux serveur local (réponses HTTP brutes, une par
    // connexion) : le vrai chemin reqwest + SSE + canal, sans réseau.
    mod retries {
        use super::super::{stream_with_retries, CompatStreamEvent, ProviderDef};
        use serde_json::Value;
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Arc, Mutex,
        };
        use tauri::ipc::{Channel, InvokeResponseBody};

        fn fake_provider(responses: Vec<String>) -> (&'static ProviderDef, Arc<AtomicUsize>) {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let port = listener.local_addr().unwrap().port();
            let served = Arc::new(AtomicUsize::new(0));
            let counter = served.clone();
            std::thread::spawn(move || {
                for response in responses {
                    let Ok((mut socket, _)) = listener.accept() else { return };
                    let mut request = Vec::new();
                    let mut chunk = [0u8; 4096];
                    // En-têtes puis corps (Content-Length) : répondre avant d'avoir tout lu
                    // ferait couper la connexion côté client.
                    loop {
                        let read = socket.read(&mut chunk).unwrap_or(0);
                        if read == 0 { break }
                        request.extend_from_slice(&chunk[..read]);
                        let text = String::from_utf8_lossy(&request);
                        if let Some(head_end) = text.find("\r\n\r\n") {
                            let length = text[..head_end]
                                .lines()
                                .find_map(|line| line.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0)))
                                .unwrap_or(0);
                            if request.len() >= head_end + 4 + length { break }
                        }
                    }
                    counter.fetch_add(1, Ordering::SeqCst);
                    let _ = socket.write_all(response.as_bytes());
                }
            });
            let def = Box::leak(Box::new(ProviderDef {
                id: "test",
                what: "la clé de test",
                base_url: Box::leak(format!("http://127.0.0.1:{port}").into_boxed_str()),
                key_target: "test",
                default_models: &[],
                probe_model: "m",
                thinking_param: false,
            }));
            (def, served)
        }

        fn http(status: &str, content_type: &str, body: &str) -> String {
            format!("HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len())
        }

        fn sse(events: &[&str]) -> String {
            http("200 OK", "text/event-stream", &events.iter().map(|e| format!("data: {e}\n\n")).collect::<String>())
        }

        fn run(def: &'static ProviderDef) -> (Result<(), String>, Vec<Value>) {
            let events = Arc::new(Mutex::new(Vec::new()));
            let sink = events.clone();
            let channel = Channel::<CompatStreamEvent>::new(move |body| {
                if let InvokeResponseBody::Json(json) = body {
                    sink.lock().unwrap().push(serde_json::from_str(&json).unwrap());
                }
                Ok(())
            });
            let (_cancel_tx, mut cancel_rx) = tokio::sync::oneshot::channel();
            let body = serde_json::json!({ "model": "m", "messages": [], "stream": true });
            let result = tauri::async_runtime::block_on(stream_with_retries(def, "cle", &body, &channel, &mut cancel_rx));
            let collected = events.lock().unwrap().clone();
            (result, collected)
        }

        const HELLO: &str = r#"{"choices":[{"delta":{"content":"Bonjour"}}]}"#;

        #[test]
        fn retries_an_overload_before_any_text() {
            let (def, served) = fake_provider(vec![
                http("529 Overloaded", "application/json", r#"{"error":{"message":"The server cluster is currently under high load"}}"#),
                sse(&[r#"{"choices":[{"delta":{"reasoning_content":"hmm"}}]}"#, HELLO, "[DONE]"]),
            ]);
            let (result, events) = run(def);
            assert_eq!(result, Ok(()));
            assert_eq!(served.load(Ordering::SeqCst), 2);
            let kinds: Vec<&str> = events.iter().filter_map(|e| e["kind"].as_str()).collect();
            assert_eq!(kinds, ["thinking", "delta", "done"]);
            assert_eq!(events[1]["text"], "Bonjour");
        }

        #[test]
        fn retries_a_stream_that_ends_with_reasoning_only() {
            let (def, served) = fake_provider(vec![
                sse(&[r#"{"choices":[{"delta":{"reasoning_content":"hmm"}}]}"#, "[DONE]"]),
                sse(&[HELLO, "[DONE]"]),
            ]);
            let (result, _) = run(def);
            assert_eq!(result, Ok(()));
            assert_eq!(served.load(Ordering::SeqCst), 2);
        }

        #[test]
        fn never_retries_once_text_is_visible() {
            let (def, served) = fake_provider(vec![
                sse(&[HELLO, r#"{"error":{"type":"overloaded_error","message":"busy"}}"#]),
                sse(&[HELLO, "[DONE]"]),
            ]);
            let (result, events) = run(def);
            assert_eq!(result, Err("busy".to_string()));
            assert_eq!(served.load(Ordering::SeqCst), 1);
            assert_eq!(events.iter().filter(|e| e["kind"] == "delta").count(), 1);
        }

        #[test]
        fn fails_at_once_on_a_rejected_key_and_gives_up_after_two_retries() {
            let (def, served) = fake_provider(vec![http("401 Unauthorized", "application/json", "{}")]);
            let (result, _) = run(def);
            assert!(result.unwrap_err().contains("n'est plus acceptée"));
            assert_eq!(served.load(Ordering::SeqCst), 1);

            let overload = http("503 Service Unavailable", "application/json", r#"{"error":{"message":"indisponible"}}"#);
            let (def, served) = fake_provider(vec![overload.clone(), overload.clone(), overload]);
            let (result, _) = run(def);
            assert_eq!(result, Err("indisponible".to_string()));
            assert_eq!(served.load(Ordering::SeqCst), 3);
        }
    }
}
