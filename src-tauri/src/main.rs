// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // The same executable doubles as the Claude Code collector (statusLine / hook
    // command). CLI mode never initialises Tauri, so it starts in milliseconds.
    if let Some(code) = ai_coding_pet_lib::collector::cli::try_run_cli() {
        std::process::exit(code);
    }
    ai_coding_pet_lib::run()
}
