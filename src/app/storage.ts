import {
  writeFile,
  readFile,
  readTextFile,
  writeTextFile,
  mkdir,
  exists,
} from '@tauri-apps/plugin-fs'
import { BaseDirectory } from '@tauri-apps/api/path'
import type { ClipItem } from '../core/types'

const HISTORY = 'history.json'
const IMG_DIR = 'images'

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
function bytesToB64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

export async function loadHistory(): Promise<ClipItem[]> {
  try {
    if (!(await exists(HISTORY, { baseDir: BaseDirectory.AppData }))) return []
    const txt = await readTextFile(HISTORY, { baseDir: BaseDirectory.AppData })
    return JSON.parse(txt) as ClipItem[]
  } catch {
    return []
  }
}

export async function saveHistory(list: ClipItem[]): Promise<void> {
  await writeTextFile(HISTORY, JSON.stringify(list), { baseDir: BaseDirectory.AppData })
}

export async function saveImagePng(id: string, base64png: string): Promise<string> {
  if (!(await exists(IMG_DIR, { baseDir: BaseDirectory.AppData }))) {
    await mkdir(IMG_DIR, { baseDir: BaseDirectory.AppData, recursive: true })
  }
  const path = `${IMG_DIR}/${id}.png`
  await writeFile(path, b64ToBytes(base64png), { baseDir: BaseDirectory.AppData })
  return path
}

export async function readImageDataUrl(path: string): Promise<string> {
  const bytes = await readFile(path, { baseDir: BaseDirectory.AppData })
  return `data:image/png;base64,${bytesToB64(bytes)}`
}
