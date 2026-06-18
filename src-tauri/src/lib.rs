use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{
    Builder as GsBuilder, Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
};

#[cfg(target_os = "macos")]
use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication, NSWorkspace};

// ──────────────────────────────────────────────────────────────────────────────
// 도메인 타입
// ──────────────────────────────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct ClipItem {
    pub id: String,
    pub kind: String, // "text" | "image" | "files"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files: Option<Vec<String>>,
    pub preview: String,
    pub created_at: i64,
}

// ──────────────────────────────────────────────────────────────────────────────
// 앱 상태
// ──────────────────────────────────────────────────────────────────────────────

#[derive(Default)]
struct PrevApp(Mutex<Option<i32>>);

struct History(Mutex<Vec<ClipItem>>);

struct AppDirs {
    images_dir: std::path::PathBuf,
    history_path: std::path::PathBuf,
}

// ──────────────────────────────────────────────────────────────────────────────
// 파일 I/O 헬퍼
// ──────────────────────────────────────────────────────────────────────────────

fn load_history(path: &std::path::Path) -> Vec<ClipItem> {
    match std::fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => vec![],
    }
}

fn persist_history(path: &std::path::Path, items: &[ClipItem]) {
    if let Ok(json) = serde_json::to_string(items) {
        let _ = std::fs::write(path, json);
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// macOS 클립보드 / 시스템 헬퍼
// ──────────────────────────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn frontmost_pid() -> Option<i32> {
    let ws = NSWorkspace::sharedWorkspace();
    ws.frontmostApplication()
        .map(|a| a.processIdentifier() as i32)
}

#[cfg(target_os = "macos")]
fn activate_pid(pid: i32) {
    if let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(pid) {
        #[allow(deprecated)]
        app.activateWithOptions(NSApplicationActivationOptions::ActivateIgnoringOtherApps);
    }
}

#[cfg(target_os = "macos")]
fn send_cmd_v() {
    use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    if let Ok(src) = CGEventSource::new(CGEventSourceStateID::CombinedSessionState) {
        let v: core_graphics::event::CGKeyCode = 0x09;
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

// ──────────────────────────────────────────────────────────────────────────────
// 백그라운드 클립보드 폴링 스레드 (macOS 전용)
// ──────────────────────────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn start_clipboard_monitor(app: tauri::AppHandle) {
    use objc2::runtime::AnyClass;
    use objc2_app_kit::{
        NSPasteboard, NSPasteboardTypePNG, NSPasteboardTypeString, NSPasteboardTypeTIFF,
    };
    use objc2_foundation::NSURL;
    use std::collections::hash_map::DefaultHasher;
    use std::ffi::CStr;
    use std::hash::{Hash, Hasher};

    std::thread::spawn(move || {
        let history_state = app.state::<History>();
        let dirs_state = app.state::<AppDirs>();

        let images_dir = dirs_state.images_dir.clone();
        let history_path = dirs_state.history_path.clone();

        let pb = NSPasteboard::generalPasteboard();
        let mut last_change: objc2_foundation::NSInteger = pb.changeCount();

        loop {
            std::thread::sleep(std::time::Duration::from_millis(700));

            let current_change = pb.changeCount();
            if current_change == last_change {
                continue;
            }
            last_change = current_change;

            // 1. 파일 URL 우선: readObjectsForClasses로 NSURL 배열 읽기
            let maybe_item: Option<ClipItem> = 'build: {
                let file_paths: Vec<String> = unsafe {
                    // CStr 리터럴로 NSURL 클래스 취득
                    let nsurl_class_name = CStr::from_bytes_with_nul_unchecked(b"NSURL\0");
                    match AnyClass::get(nsurl_class_name) {
                        None => vec![],
                        Some(cls) => {
                            // NSArray<AnyClass> from_slice expects &[&AnyClass]
                            use objc2_foundation::NSArray;
                            let cls_arr = NSArray::from_slice(&[cls]);
                            match pb.readObjectsForClasses_options(&cls_arr, None) {
                                None => vec![],
                                Some(arr) => {
                                    let mut paths = Vec::new();
                                    for i in 0..arr.count() {
                                        let obj = arr.objectAtIndex(i);
                                        // obj는 AnyObject; NSURL로 재해석
                                        let raw: *const NSURL =
                                            objc2::rc::Retained::as_ptr(&obj) as *const NSURL;
                                        let url: &NSURL = &*raw;
                                        if url.isFileURL() {
                                            if let Some(p) = url.path() {
                                                paths.push(p.to_string());
                                            }
                                        }
                                    }
                                    paths
                                }
                            }
                        }
                    }
                };

                if !file_paths.is_empty() {
                    let preview = file_paths
                        .iter()
                        .map(|p| {
                            std::path::Path::new(p)
                                .file_name()
                                .and_then(|n| n.to_str())
                                .unwrap_or(p.as_str())
                                .to_string()
                        })
                        .collect::<Vec<_>>()
                        .join(", ");

                    let id = make_id();

                    break 'build Some(ClipItem {
                        id,
                        kind: "files".to_string(),
                        text: None,
                        image_path: None,
                        files: Some(file_paths),
                        preview,
                        created_at: unix_now_secs(),
                    });
                }

                // 2. 텍스트
                let text_val = unsafe {
                    pb.stringForType(NSPasteboardTypeString)
                        .map(|s| s.to_string())
                        .filter(|s| !s.is_empty())
                };

                if let Some(text) = text_val {
                    let preview = text.chars().take(200).collect::<String>();
                    let id = make_id();

                    break 'build Some(ClipItem {
                        id,
                        kind: "text".to_string(),
                        text: Some(text),
                        image_path: None,
                        files: None,
                        preview,
                        created_at: unix_now_secs(),
                    });
                }

                // 3. 이미지 (PNG 우선, 없으면 TIFF → image 크레이트으로 PNG 변환)
                let img_bytes_opt: Option<(Vec<u8>, bool /* is_png */)> = unsafe {
                    if let Some(data) = pb.dataForType(NSPasteboardTypePNG) {
                        let bytes = data.to_vec();
                        if !bytes.is_empty() {
                            Some((bytes, true))
                        } else {
                            None
                        }
                    } else if let Some(data) = pb.dataForType(NSPasteboardTypeTIFF) {
                        let bytes = data.to_vec();
                        if !bytes.is_empty() {
                            Some((bytes, false))
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                };

                if let Some((raw_bytes, is_png)) = img_bytes_opt {
                    let png_bytes: Option<Vec<u8>> = if is_png {
                        Some(raw_bytes)
                    } else {
                        // TIFF → PNG 변환
                        use std::io::Cursor;
                        let cursor = Cursor::new(&raw_bytes);
                        match image::load(cursor, image::ImageFormat::Tiff) {
                            Ok(dyn_img) => {
                                let mut out = Vec::new();
                                let mut out_cursor = Cursor::new(&mut out);
                                if dyn_img
                                    .write_to(&mut out_cursor, image::ImageFormat::Png)
                                    .is_ok()
                                {
                                    Some(out)
                                } else {
                                    None
                                }
                            }
                            Err(_) => None,
                        }
                    };

                    if let Some(png) = png_bytes {
                        let byte_len = png.len();
                        let mut hasher = DefaultHasher::new();
                        png[..png.len().min(512)].hash(&mut hasher);
                        let hash = hasher.finish();

                        let id = make_id();
                        let img_path = images_dir.join(format!("{}.png", id));
                        if std::fs::write(&img_path, &png).is_ok() {
                            let _ = (byte_len, hash); // content_key 계산에 활용 (디버그)
                            break 'build Some(ClipItem {
                                id,
                                kind: "image".to_string(),
                                text: None,
                                image_path: Some(img_path.to_string_lossy().to_string()),
                                files: None,
                                preview: "[이미지]".to_string(),
                                created_at: unix_now_secs(),
                            });
                        }
                    }
                }

                None
            };

            if let Some(item) = maybe_item {
                let mut guard = history_state.0.lock().unwrap();

                // 중복 제거: 최근 항목과 내용 키 비교
                let is_dup = if let Some(prev) = guard.first() {
                    content_key_of(prev) == content_key_of(&item)
                } else {
                    false
                };

                if !is_dup {
                    guard.insert(0, item);
                    if guard.len() > 200 {
                        guard.truncate(200);
                    }
                    persist_history(&history_path, &guard);
                    drop(guard);
                    let _ = app.emit("history-updated", ());
                }
            }
        }
    });
}

#[cfg(target_os = "macos")]
fn content_key_of(item: &ClipItem) -> String {
    match item.kind.as_str() {
        "text" => item.text.clone().unwrap_or_default(),
        "files" => {
            let mut paths = item.files.clone().unwrap_or_default();
            paths.sort();
            paths.join("|")
        }
        "image" => item.image_path.clone().unwrap_or_default(),
        _ => String::new(),
    }
}

fn make_id() -> String {
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let seq = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    format!("{}-{}", unix_now_millis(), seq)
}

fn unix_now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn unix_now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

// ──────────────────────────────────────────────────────────────────────────────
// Tauri invoke 커맨드
// ──────────────────────────────────────────────────────────────────────────────

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
fn get_history(state: tauri::State<History>) -> Vec<ClipItem> {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
fn clear_history(state: tauri::State<History>, dirs: tauri::State<AppDirs>) {
    let mut guard = state.0.lock().unwrap();
    for item in guard.iter() {
        if let Some(ref path) = item.image_path {
            let _ = std::fs::remove_file(path);
        }
    }
    guard.clear();
    persist_history(&dirs.history_path, &guard);
}

#[tauri::command]
fn paste_clip(id: String, state: tauri::State<History>, prev_app: tauri::State<PrevApp>) {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{NSPasteboard, NSPasteboardTypePNG, NSPasteboardTypeString};
        use objc2_foundation::{NSData, NSString};

        let guard = state.0.lock().unwrap();
        let item = guard.iter().find(|i| i.id == id).cloned();
        drop(guard);

        if let Some(item) = item {
            let pb = NSPasteboard::generalPasteboard();
            pb.clearContents();

            match item.kind.as_str() {
                "text" => {
                    if let Some(ref text) = item.text {
                        let ns_str = NSString::from_str(text);
                        unsafe {
                            pb.setString_forType(&ns_str, NSPasteboardTypeString);
                        }
                    }
                }
                "image" => {
                    if let Some(ref path) = item.image_path {
                        if let Ok(bytes) = std::fs::read(path) {
                            let data = NSData::with_bytes(&bytes);
                            unsafe {
                                pb.setData_forType(Some(&data), NSPasteboardTypePNG);
                            }
                        }
                    }
                }
                "files" => {
                    if let Some(ref paths) = item.files {
                        use objc2_app_kit::NSURLNSPasteboardSupport;
                        use objc2_foundation::NSURL;
                        for path in paths {
                            let ns_str = NSString::from_str(path);
                            let url = NSURL::fileURLWithPath(&ns_str);
                            url.writeToPasteboard(&pb);
                        }
                    }
                }
                _ => {}
            }

            // 이전 앱 활성화 + Cmd+V
            let pid = *prev_app.0.lock().unwrap();
            if let Some(pid) = pid {
                activate_pid(pid);
            }
            std::thread::sleep(std::time::Duration::from_millis(70));
            send_cmd_v();
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (id, state, prev_app);
    }
}

/// 기존 paste_selected: React 코드가 아직 이를 호출하므로 유지
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

// ──────────────────────────────────────────────────────────────────────────────
// 앱 진입점
// ──────────────────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let shortcut = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyV);

    tauri::Builder::default()
        .manage(PrevApp::default())
        .manage(History(Mutex::new(vec![])))
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

            // 앱 데이터 디렉터리 설정
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("app_data_dir 취득 실패");
            let images_dir = data_dir.join("images");
            std::fs::create_dir_all(&images_dir).ok();

            let history_path = data_dir.join("history.json");

            // 기존 히스토리 로드
            let loaded = load_history(&history_path);
            {
                let hist = app.state::<History>();
                *hist.0.lock().unwrap() = loaded;
            }

            // AppDirs 상태 등록
            app.manage(AppDirs {
                images_dir,
                history_path,
            });

            // 글로벌 단축키 등록
            app.global_shortcut().register(shortcut)?;

            // 백그라운드 클립보드 모니터 시작
            #[cfg(target_os = "macos")]
            start_clipboard_monitor(app.handle().clone());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            accessibility_ok,
            accessibility_prompt,
            paste_selected,
            get_history,
            clear_history,
            paste_clip,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
