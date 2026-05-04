fn main() {
    if std::env::var_os("TEAMFLOW_SKIP_TAURI_BUILD").is_some() {
        return;
    }
    tauri_build::build();
}
