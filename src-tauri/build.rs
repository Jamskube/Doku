fn main() {
    // Réembarque l'icône Windows dès qu'elle change (sinon l'exe garde l'ancienne
    // et la barre des tâches affiche un logo périmé).
    println!("cargo:rerun-if-changed=icons/icon.ico");
    tauri_build::build()
}
