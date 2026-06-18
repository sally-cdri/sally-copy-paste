import { invoke } from '@tauri-apps/api/core'

export const accessibilityOk = () => invoke<boolean>('accessibility_ok')
export const promptAccessibility = () => invoke<void>('accessibility_prompt')
export const pasteSelected = () => invoke<void>('paste_selected')
