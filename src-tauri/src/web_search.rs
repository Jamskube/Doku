use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

const YAHOO_SEARCH_ENDPOINT: &str = "https://search.yahoo.com/search";
const BING_RSS_ENDPOINT: &str = "https://www.bing.com/search";
const MAX_QUERY_CHARS: usize = 500;
const MAX_RESULTS: usize = 8;
const CACHE_TTL: Duration = Duration::from_secs(10 * 60);

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
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Doku/3.1")
            .build()
            .unwrap_or_default()
    })
}

fn cache() -> &'static Mutex<HashMap<String, (Instant, Vec<WebSearchResult>)>> {
    static CACHE: OnceLock<Mutex<HashMap<String, (Instant, Vec<WebSearchResult>)>>> =
        OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn decode_html(value: &str) -> String {
    value
        .replace("<![CDATA[", "")
        .replace("]]>", "")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
        .replace("&mdash;", "—")
        .replace("&ldquo;", "“")
        .replace("&rdquo;", "”")
        .replace("&nbsp;", " ")
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

fn xml_element(value: &str, tag: &str) -> Option<String> {
    let start_marker = format!("<{tag}>");
    let end_marker = format!("</{tag}>");
    let tail = &value[value.find(&start_marker)? + start_marker.len()..];
    let end = tail.find(&end_marker)?;
    Some(strip_html(&tail[..end]))
}

fn attribute_after(value: &str, attribute: &str) -> Option<String> {
    let needle = format!(r#"{attribute}=""#);
    let tail = &value[value.find(&needle)? + needle.len()..];
    Some(decode_html(&tail[..tail.find('"')?]))
}

fn tag_content_after(value: &str, marker: &str, closing_tag: &str) -> Option<String> {
    let tail = &value[value.find(marker)? + marker.len()..];
    let tail = &tail[tail.find('>')? + 1..];
    Some(strip_html(&tail[..tail.find(closing_tag)?]))
}

fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).ok()?;
            decoded.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            decoded.push(if bytes[index] == b'+' {
                b' '
            } else {
                bytes[index]
            });
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

fn yahoo_destination(value: &str) -> Option<String> {
    if !value.contains("r.search.yahoo.com") {
        return Some(value.to_string());
    }
    let encoded = value.split("/RU=").nth(1)?.split("/RK=").next()?;
    percent_decode(encoded)
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

fn matched_terms(result: &WebSearchResult, terms: &HashSet<String>) -> usize {
    let haystack = format!("{} {} {}", result.title, result.url, result.snippet).to_lowercase();
    terms
        .iter()
        .filter(|term| haystack.contains(term.as_str()))
        .count()
}

fn rank_results(candidates: Vec<WebSearchResult>, query: &str) -> Vec<WebSearchResult> {
    let terms = search_terms(query);
    let minimum_matches = usize::from(terms.len() >= 4) + 1;
    let mut seen = HashSet::new();
    let mut results = candidates
        .into_iter()
        .filter_map(|result| {
            if !seen.insert(result.url.clone()) {
                return None;
            }
            let score = relevance(&result, &terms);
            (score >= 2 && matched_terms(&result, &terms) >= minimum_matches)
                .then_some((score, result))
        })
        .collect::<Vec<_>>();
    results.sort_by(|a, b| b.0.cmp(&a.0));
    results
        .into_iter()
        .take(MAX_RESULTS)
        .map(|(_, result)| result)
        .collect()
}

fn parse_bing_results(xml: &str, query: &str) -> Vec<WebSearchResult> {
    let candidates = xml
        .split("<item>")
        .skip(1)
        .filter_map(|chunk| {
            let url = xml_element(chunk, "link")?;
            let safe = reqwest::Url::parse(&url).ok()?.scheme() == "https";
            if !safe {
                return None;
            }
            let title = xml_element(chunk, "title")?;
            let snippet = xml_element(chunk, "description").unwrap_or_default();
            Some(WebSearchResult {
                title,
                url,
                snippet,
            })
        })
        .collect::<Vec<_>>();
    rank_results(candidates, query)
}

fn parse_yahoo_results(html: &str, query: &str) -> Vec<WebSearchResult> {
    let candidates = html
        .split("class=\"dd algo")
        .skip(1)
        .filter_map(|chunk| {
            let url = yahoo_destination(&attribute_after(chunk, "href")?)?;
            if reqwest::Url::parse(&url).ok()?.scheme() != "https" {
                return None;
            }
            let title = tag_content_after(chunk, "<h3", "</h3>")?;
            let snippet = chunk
                .find("class=\"compText")
                .and_then(|start| tag_content_after(&chunk[start..], "<p", "</p>"))
                .unwrap_or_default();
            Some(WebSearchResult {
                title,
                url,
                snippet,
            })
        })
        .collect();
    rank_results(candidates, query)
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
    let cache_key = query.to_lowercase();
    if let Ok(mut entries) = cache().lock() {
        entries.retain(|_, (stored_at, _)| stored_at.elapsed() < CACHE_TTL);
        if let Some((_, results)) = entries.get(&cache_key) {
            return Ok(results.clone());
        }
    }

    let yahoo = client()
        .get(YAHOO_SEARCH_ENDPOINT)
        .query(&[("p", query), ("ei", "UTF-8")])
        .send()
        .await;
    let mut results = match yahoo {
        Ok(response) if response.status().is_success() => response
            .text()
            .await
            .ok()
            .map(|html| parse_yahoo_results(&html, query))
            .unwrap_or_default(),
        _ => Vec::new(),
    };

    // Le HTML public peut changer ou refuser ponctuellement les clients automatisés.
    // Le flux RSS de Bing constitue un repli indépendant, sans clé ni second appel modèle.
    if results.is_empty() {
        let response = client()
            .get(BING_RSS_ENDPOINT)
            .query(&[
                ("q", query),
                ("format", "rss"),
                ("setlang", "fr-BE"),
                ("cc", "BE"),
            ])
            .send()
            .await
            .map_err(|error| format!("Recherche Web inaccessible : {error}"))?;
        if !response.status().is_success() {
            return Err(format!(
                "Les moteurs de recherche Web sont temporairement indisponibles ({}).",
                response.status()
            ));
        }
        let xml = response
            .text()
            .await
            .map_err(|error| format!("Résultats Web illisibles : {error}"))?;
        results = parse_bing_results(&xml, query);
    }
    if results.is_empty() {
        return Err("Aucun résultat Web exploitable n'a été trouvé.".to_string());
    }
    if let Ok(mut entries) = cache().lock() {
        entries.insert(cache_key, (Instant::now(), results.clone()));
    }
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_relevant_https_results_only() {
        let xml = r#"
          <item><title>OpenAI &amp; TVA</title><link>https://help.openai.com/vat</link><description>Factures reverse charge Belgique</description></item>
          <item><title>E.T. le film</title><link>https://example.com/film</link><description>Cinéma</description></item>
          <item><title>OpenAI TVA</title><link>http://openai.example/vat</link><description>Belgique</description></item>
        "#;
        assert_eq!(
            parse_bing_results(xml, "OpenAI facture TVA reverse charge Belgique"),
            vec![WebSearchResult {
                title: "OpenAI & TVA".into(),
                url: "https://help.openai.com/vat".into(),
                snippet: "Factures reverse charge Belgique".into(),
            }]
        );
    }

    #[test]
    fn parses_yahoo_redirects_and_snippets() {
        let html = r#"
          <div class="dd algo algo-sr"><a href="https://r.search.yahoo.com/x/RU=https%3a%2f%2fvat.example%2fbelgium/RK=2/RS=x"><h3><span>VAT Reverse Charge in Belgium</span></h3></a><div class="compText"><p>OpenAI invoice and Belgian VAT rules.</p></div></div>
        "#;
        assert_eq!(
            parse_yahoo_results(html, "OpenAI invoice VAT Belgium reverse charge"),
            vec![WebSearchResult {
                title: "VAT Reverse Charge in Belgium".into(),
                url: "https://vat.example/belgium".into(),
                snippet: "OpenAI invoice and Belgian VAT rules.".into(),
            }]
        );
    }

    #[tokio::test]
    #[ignore = "smoke réseau explicite"]
    async fn live_search_returns_relevant_results() {
        let results = web_search("OpenAI invoice VAT Belgium reverse charge".into())
            .await
            .expect("la recherche multi-moteur doit répondre");
        assert!(!results.is_empty());
        assert!(results
            .iter()
            .all(|result| result.url.starts_with("https://")));
    }
}
