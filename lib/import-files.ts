'use client'

export type ImportFilePayload = {
  originalFileName: string
  sourceMimeType: string
  fileText?: string
  fileBase64?: string
  conversionKind: 'browser-text-file' | 'browser-base64-file'
}

const TEXT_FILE_EXTENSIONS = new Set([
  'md',
  'markdown',
  'txt',
  'csv',
  'json',
  'yaml',
  'yml',
  'xml',
  'html',
  'htm',
  'ts',
  'tsx',
  'js',
  'jsx',
  'py',
  'java',
  'c',
  'cpp',
  'cs',
  'go',
  'rs',
  'sql',
])

export function isTextLikeImportFile(file: File) {
  const mime = (file.type || '').toLowerCase()
  if (mime.startsWith('text/')) return true
  if (mime.includes('json') || mime.includes('xml') || mime.includes('markdown')) return true
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  return TEXT_FILE_EXTENSIONS.has(ext)
}

export async function readImportFilePayload(file: File): Promise<ImportFilePayload> {
  const sourceMimeType = file.type || 'application/octet-stream'
  if (isTextLikeImportFile(file)) {
    return {
      originalFileName: file.name,
      sourceMimeType,
      fileText: await file.text(),
      conversionKind: 'browser-text-file',
    }
  }

  return {
    originalFileName: file.name,
    sourceMimeType,
    fileBase64: await readFileAsDataUrl(file),
    conversionKind: 'browser-base64-file',
  }
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}
