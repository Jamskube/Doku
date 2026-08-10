// Découpe et parse des flux SSE (Server-Sent Events), partagés entre les fournisseurs
// cloud (OpenAI Codex, compatibles OpenAI). Extrait d'openai.rs (ADR-0018).
use serde_json::Value;

pub fn find_sse_boundary(bytes: &[u8]) -> Option<(usize, usize)> {
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

/// Résultat d'un événement SSE : du JSON, la fin de flux (`[DONE]`), ou rien (keep-alive).
pub enum SseEvent {
    Json(Value),
    Done,
    Empty,
}

pub fn parse_sse_event(bytes: &[u8]) -> Result<SseEvent, String> {
    let event = std::str::from_utf8(bytes).map_err(|_| "Flux invalide (UTF-8).".to_string())?;
    let data = event
        .lines()
        .filter_map(|line| line.strip_prefix("data:"))
        .map(str::trim_start)
        .collect::<Vec<_>>()
        .join("\n");
    if data.is_empty() {
        return Ok(SseEvent::Empty);
    }
    if data == "[DONE]" {
        return Ok(SseEvent::Done);
    }
    serde_json::from_str(&data)
        .map(SseEvent::Json)
        .map_err(|_| "Événement de flux invalide.".to_string())
}

#[cfg(test)]
mod tests {
    use super::{find_sse_boundary, parse_sse_event, SseEvent};

    #[test]
    fn recognizes_boundaries_and_done() {
        assert_eq!(find_sse_boundary(b"a\n\nb"), Some((1, 2)));
        assert_eq!(find_sse_boundary(b"a\r\n\r\nb"), Some((1, 4)));
        assert!(matches!(parse_sse_event(b"data: [DONE]"), Ok(SseEvent::Done)));
        assert!(matches!(parse_sse_event(b": ping"), Ok(SseEvent::Empty)));
    }
}
