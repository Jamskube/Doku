// Secrets protégés par le coffre du système, partagés entre fournisseurs (session OpenAI,
// clé MiniMax…). Extrait d'openai.rs à l'arrivée du second fournisseur cloud (ADR-0018).
// `what` nomme le secret dans les messages d'erreur (« la session OpenAI », « la clé
// MiniMax ») — une erreur MiniMax ne parle jamais d'OpenAI.
//
// DEUX implémentations, une seule API (ADR-0026) : Credential Manager en natif sous
// Windows (CredWriteW/CredReadW), Secret Service via `keyring` ailleurs. Windows n'est
// PAS passé sur `keyring` : la convention de nommage des identifiants y diffère, et le
// changement orphelinerait en silence les secrets déjà stockés chez les utilisateurs.

#[cfg(windows)]
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
pub fn write_secret(target: &str, value: &str, what: &str) -> Result<(), String> {
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
        .map_err(|_| format!("Impossible de protéger {what} dans Windows."))
}

#[cfg(windows)]
pub fn read_secret(target: &str, what: &str) -> Result<Option<String>, String> {
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
                .map_err(|_| format!("Impossible de déchiffrer {what}."));
            unsafe { CredFree(raw.cast()) };
            value.map(Some)
        }
        Err(error) if error.code() == HRESULT::from_win32(ERROR_NOT_FOUND.0) => Ok(None),
        Err(_) => Err(format!("Impossible de lire {what}.")),
    }
}

#[cfg(windows)]
pub fn delete_secret(target: &str, what: &str) -> Result<(), String> {
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
        Err(_) => Err(format!("Impossible de supprimer {what}.")),
    }
}

// Hors Windows : le Secret Service de la session (GNOME Keyring, KWallet, KeePassXC…),
// via `keyring`. Même contrat que la face Windows — mêmes noms de cible, même nom
// d'utilisateur « Doku », lecture absente = `Ok(None)`, suppression idempotente — pour
// que compat.rs et openai.rs ne connaissent qu'une seule API.
//
// Le magasin est installé paresseusement au premier `Entry::new`, qui ÉCHOUE si aucun
// service de secrets ne tourne. C'est le cas fréquent d'une session sans environnement
// de bureau : il est nommé, avec la marche à suivre, jamais rendu tel quel.
#[cfg(not(windows))]
fn entry(target: &str, what: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(target, "Doku").map_err(|error| match error {
        keyring::Error::PlatformFailure(_) | keyring::Error::NoStorageAccess(_) => format!(
            "Aucun trousseau de session n'est accessible pour {what}. Installez et démarrez un service de secrets (GNOME Keyring, KWallet ou KeePassXC), puis reconnectez-vous."
        ),
        other => format!("Le trousseau de session est inutilisable pour {what} ({other})."),
    })
}

#[cfg(not(windows))]
pub fn write_secret(target: &str, value: &str, what: &str) -> Result<(), String> {
    entry(target, what)?
        .set_password(value)
        .map_err(|_| format!("Impossible de protéger {what} dans le trousseau."))
}

#[cfg(not(windows))]
pub fn read_secret(target: &str, what: &str) -> Result<Option<String>, String> {
    match entry(target, what)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err(format!("Impossible de lire {what}.")),
    }
}

#[cfg(not(windows))]
pub fn delete_secret(target: &str, what: &str) -> Result<(), String> {
    match entry(target, what)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err(format!("Impossible de supprimer {what}.")),
    }
}
