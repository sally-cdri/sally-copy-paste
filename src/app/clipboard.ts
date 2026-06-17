import {
  startListening,
  onTextUpdate,
  onImageUpdate,
  writeText,
  writeImageBase64,
} from 'tauri-plugin-clipboard-api'

export async function startClipboardMonitor(): Promise<() => void> {
  return startListening()
}

export function onText(cb: (text: string) => void): Promise<() => void> {
  return onTextUpdate(cb)
}

export function onImage(cb: (base64png: string) => void): Promise<() => void> {
  return onImageUpdate(cb)
}

export function writeClipboardText(text: string): Promise<void> {
  return writeText(text)
}

export function writeClipboardImage(base64png: string): Promise<void> {
  return writeImageBase64(base64png)
}
