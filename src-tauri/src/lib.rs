use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Builder as GsBuilder, Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[cfg(target_os = "macos")]
use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication, NSWorkspace};

// 직전 프런트 앱 pid 보관
#[derive(Default)]
struct PrevApp(Mutex<Option<i32>>);

#[cfg(target_os = "macos")]
fn frontmost_pid() -> Option<i32> {
    let ws = NSWorkspace::sharedWorkspace();
    ws.frontmostApplication()
        .map(|a| a.processIdentifier() as i32)
}

#[cfg(target_os = "macos")]
fn activate_pid(pid: i32) {
    if let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(pid) {
        // activateWithOptions: deprecated macOS 14+ but still compiles
        #[allow(deprecated)]
        app.activateWithOptions(NSApplicationActivationOptions::ActivateIgnoringOtherApps);
    }
}

#[cfg(target_os = "macos")]
fn send_cmd_v() {
    use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    if let Ok(src) = CGEventSource::new(CGEventSourceStateID::CombinedSessionState) {
        let v: core_graphics::event::CGKeyCode = 0x09; // 'v'
        if let (Ok(down), Ok(up)) = (
            CGEvent::new_keyboard_event(src.clone(), v, true),
            CGEvent::new_keyboard_event(src, v, false),
        ) {
            down.set_flags(CGEventFlags::CGEventFlagCommand);
            up.set_flags(CGEventFlags::CGEventFlagCommand);
            down.post(CGEventTapLocation::HID);
            up.post(CGEventTapLocation::HID);
        }
    }
}

#[tauri::command]
fn accessibility_ok() -> bool {
    #[cfg(target_os = "macos")]
    {
        macos_accessibility_client::accessibility::application_is_trusted()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

#[tauri::command]
fn accessibility_prompt() {
    #[cfg(target_os = "macos")]
    {
        macos_accessibility_client::accessibility::application_is_trusted_with_prompt();
    }
}

#[tauri::command]
fn paste_selected(state: tauri::State<PrevApp>) {
    #[cfg(target_os = "macos")]
    {
        let pid = *state.0.lock().unwrap();
        if let Some(pid) = pid {
            activate_pid(pid);
        }
        std::thread::sleep(std::time::Duration::from_millis(70));
        send_cmd_v();
    }
    #[cfg(not(target_os = "macos"))]
    let _ = state;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let shortcut = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyV);

    tauri::Builder::default()
        .manage(PrevApp::default())
        .plugin(tauri_plugin_clipboard::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            GsBuilder::new()
                .with_handler(move |app, sc, event| {
                    if event.state() == ShortcutState::Pressed && sc == &shortcut {
                        #[cfg(target_os = "macos")]
                        {
                            let pid = frontmost_pid();
                            *app.state::<PrevApp>().0.lock().unwrap() = pid;
                        }
                        if let Some(w) = app.get_webview_window("popup") {
                            let _ = w.show();
                            let _ = w.set_focus();
                            let _ = w.emit("popup-shown", ());
                        }
                    }
                })
                .build(),
        )
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            app.global_shortcut().register(shortcut)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            accessibility_ok,
            accessibility_prompt,
            paste_selected
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
