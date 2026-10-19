use std::{
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    process::Child,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::{process::CommandChild, ShellExt};
#[cfg(debug_assertions)]
use std::{path::PathBuf, process::{Command, Stdio}};

enum ServerProcess {
    Python(Child),
    Sidecar(CommandChild),
}

struct ManagedServer(Mutex<Option<ServerProcess>>);

fn server_ready(port: u16) -> bool {
    let address: SocketAddr = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(250)) else { return false; };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(400)));
    let _ = stream.write_all(b"GET /healthz HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
    let mut response = String::new();
    stream.read_to_string(&mut response).is_ok() && response.contains("\"ok\":true")
}

fn spawn_server(app: &tauri::App, port: u16) -> Result<ServerProcess, Box<dyn std::error::Error>> {
    #[cfg(debug_assertions)]
    {
        let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let venv = project.join(".venv/Scripts/python.exe");
        let python = if venv.exists() { venv } else { PathBuf::from("python") };
        let child = Command::new(python)
            .arg(project.join("app.py"))
            .current_dir(&project)
            .env("KATYA_BIND_HOST", "127.0.0.1")
            .env("KATYA_PORT", port.to_string())
            .env("KATYA_HEADLESS", "0")
            .env("KATYA_EXTENSION_RELAY", "1")
            .env("KATYA_DESKTOP_PARENT_PID", std::process::id().to_string())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?;
        Ok(ServerProcess::Python(child))
    }
    #[cfg(not(debug_assertions))]
    {
        let data = app.path().app_data_dir()?;
        std::fs::create_dir_all(&data)?;
        let (_events, child) = app.shell().sidecar("katya-server")?
            .env("KATYA_DATA_DIR", data.to_string_lossy().as_ref())
            .env("KATYA_BIND_HOST", "127.0.0.1")
            .env("KATYA_PORT", port.to_string())
            .env("KATYA_HEADLESS", "0")
            .env("KATYA_EXTENSION_RELAY", "1")
            .env("KATYA_DESKTOP_PARENT_PID", std::process::id().to_string())
            .spawn()?;
        Ok(ServerProcess::Sidecar(child))
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(ManagedServer(Mutex::new(None)))
        .setup(|app| {
            let port: u16 = std::env::var("KATYA_DESKTOP_PORT").ok().and_then(|v| v.parse().ok()).unwrap_or(18110);
            if !server_ready(port) {
                let child = spawn_server(app, port)?;
                *app.state::<ManagedServer>().0.lock().unwrap() = Some(child);
                let deadline = Instant::now() + Duration::from_secs(45);
                while !server_ready(port) && Instant::now() < deadline {
                    std::thread::sleep(Duration::from_millis(180));
                }
            }
            if !server_ready(port) { return Err("Локальный сервер Katya не запустился".into()); }
            let url = format!("http://127.0.0.1:{port}/").parse().unwrap();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("Katya Browser Lab")
                .inner_size(1440.0, 900.0)
                .min_inner_size(900.0, 620.0)
                .build()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(server) = window.app_handle().state::<ManagedServer>().0.lock().unwrap().take() {
                    match server {
                        ServerProcess::Python(mut process) => { let _ = process.kill(); }
                        ServerProcess::Sidecar(process) => { let _ = process.kill(); }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("Katya Browser Lab failed to start");
}
