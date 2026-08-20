use serde::Serialize;
use std::{collections::HashSet, sync::OnceLock, time::Duration};

const SEARCH_ENDPOINT: &str = "https://search.brave.com/search";
const MAX_QUERY_CHARS: usize = 500;
const MAX_RESULTS: usize = 8;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchResult {
    title: String,
    url: String,
    snippet: String,
}

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .user_agent("Doku/3.1 web-context")
            .build()
            .unwrap_or_default()
    })
}

fn decode_html(value: &str) -> String {
    value
        .replace("<![CDATA[", "")
        .replace("]]>", "")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .trim()
        .to_string()
}

fn strip_html(value: &str) -> String {
    let mut text = String::with_capacity(value.len());
    let mut in_tag = false;
    for ch in value.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                text.push(' ');
            }
            _ if !in_tag => text.push(ch),
            _ => {}
        }
    }
    decode_html(&text)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn quoted_after(value: &str, marker: &str, attribute: &str) -> Option<String> {
    let tail = &value[value.find(marker)? + marker.len()..];
    let needle = format!(r#"{attribute}=""#);
    let tail = &tail[tail.find(&needle)? + needle.len()..];
    let end = tail.find('"')?;
    Some(decode_html(&tail[..end]))
}

fn element_after(value: &str, marker: &str) -> Option<String> {
    let tail = &value[value.find(marker)? + marker.len()..];
    let start = tail.find('>')? + 1;
    let tail = &tail[start..];
    let end = tail.find("</div>")?;
    Some(strip_html(&tail[..end]))
}

fn search_terms(query: &str) -> HashSet<String> {
    const STOP: &[&str] = &[
        "avec",
        "avoir",
        "cette",
        "dans",
        "document",
        "faire",
        "pour",
        "quel",
        "quelle",
        "recherche",
        "site",
        "the",
        "this",
        "web",
        "what",
        "when",
        "where",
        "with",
    ];
    query
        .split(|ch: char| !ch.is_alphanumeric())
        .map(str::to_lowercase)
        .filter(|term| term.chars().count() >= 3 && !STOP.contains(&term.as_str()))
        .collect()
}

fn relevance(result: &WebSearchResult, terms: &HashSet<String>) -> usize {
    let title = result.title.to_lowercase();
    let url = result.url.to_lowercase();
    let snippet = result.snippet.to_lowercase();
    terms
        .iter()
        .map(|term| {
            usize::from(title.contains(term)) * 3
                + usize::from(url.contains(term)) * 2
                + usize::from(snippet.contains(term))
        })
        .sum()
}

fn parse_results(html: &str, query: &str) -> Vec<WebSearchResult> {
    let terms = search_terms(query);
    let mut seen = HashSet::new();
    let mut results = html
        .split(r#"data-type="web""#)
        .skip(1)
        .filter_map(|chunk| {
            let url = quoted_after(chunk, "<a ", "href")?;
            let safe = reqwest::Url::parse(&url).ok()?.scheme() == "https";
            if !safe || !seen.insert(url.clone()) {
                return None;
            }
            let title = quoted_after(chunk, "search-snippet-title", "title")?;
            let snippet = element_after(chunk, "line-clamp-dynamic").unwrap_or_default();
            let result = WebSearchResult {
                title,
                url,
                snippet,
            };
            let score = relevance(&result, &terms);
            (score >= 2).then_some((score, result))
        })
        .collect::<Vec<_>>();
    results.sort_by(|a, b| b.0.cmp(&a.0));
    results
        .into_iter()
        .take(MAX_RESULTS)
        .map(|(_, result)| result)
        .collect()
}

#[tauri::command]
pub async fn web_search(query: String) -> Result<Vec<WebSearchResult>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("La recherche Web a besoin d'une question.".to_string());
    }
    if query.chars().count() > MAX_QUERY_CHARS {
        return Err("La question est trop longue pour une recherche Web.".to_string());
    }

    let response = client()
        .get(SEARCH_ENDPOINT)
        .query(&[("q", query), ("source", "web")])
        .send()
        .await
        .map_err(|error| format!("Recherche Web inaccessible : {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "La recherche Web a répondu avec le statut {}.",
            response.status()
        ));
    }
    let html = response
        .text()
        .await
        .map_err(|error| format!("Résultats Web illisibles : {error}"))?;
    let results = parse_results(&html, query);
    if results.is_empty() {
        return Err("Aucun résultat Web exploitable n'a été trouvé.".to_string());
    }
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_relevant_https_results_only() {
        let html = r#"
          <div class="snippet" data-type="web"><a href="https://help.openai.com/vat"><div class="title search-snippet-title" title="OpenAI &amp; TVA">OpenAI</div></a><div class="content line-clamp-dynamic"><span>Factures</span> reverse charge Belgique</div></div>
          <div class="snippet" data-type="web"><a href="https://example.com/film"><div class="title search-snippet-title" title="E.T. le film">Film</div></a><div class="content line-clamp-dynamic">Cinéma</div></div>
          <div class="snippet" data-type="web"><a href="http://openai.example/vat"><div class="title search-snippet-title" title="OpenAI TVA">OpenAI</div></a><div class="content line-clamp-dynamic">Belgique</div></div>
        "#;
        assert_eq!(
            parse_results(html, "OpenAI facture TVA reverse charge Belgique"),
            vec![WebSearchResult {
                title: "OpenAI & TVA".into(),
                url: "https://help.openai.com/vat".into(),
                snippet: "Factures reverse charge Belgique".into(),
            }]
        );
    }
}
