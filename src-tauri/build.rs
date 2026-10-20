fn main() {
    // Rebuild the embedded UI after Vite changes its hashed asset filenames.
    // Without this, an incremental EXE can retain a previous frontend bundle.
    println!("cargo:rerun-if-changed=../dist");
    // Use a custom Windows application manifest that opts the process into long
    // path support (#298/#299). app_manifest() replaces Tauri's default, so the
    // manifest file re-declares the Common-Controls v6 dependency Tauri ships.
    // On non-Windows targets the manifest is simply ignored.
    tauri_build::try_build(
        tauri_build::Attributes::new().windows_attributes(
            tauri_build::WindowsAttributes::new()
                .app_manifest(include_str!("windows-app-manifest.xml")),
        ),
    )
    .expect("failed to run tauri-build");
}
