import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import test, { after } from 'node:test'
import { closePdfRenderer, renderDocx, renderPdf, renderPptx } from '@/server/core/ai/hyperframes/resource-renderer'

const runId = `sdd-hyperframes-${Date.now()}-${Math.random().toString(36).slice(2)}`
const artifactRoot = resolve(process.cwd(), 'test', 'artifacts', 'hyperframes-renderer', runId)

test('hyperframes resource renderer produces real docx, pdf, and pptx files', async () => {
  after(async () => {
    await closePdfRenderer()
  })

  const bodyHtml = [
    '<h1>HyperFrames Demo</h1>',
    '<p>This is a renderer smoke test.</p>',
    '<ul><li>Docx output</li><li>Pdf output</li><li>Pptx output</li></ul>',
  ].join('')

  const docx = await renderDocx('HyperFrames Demo', bodyHtml)
  const pdf = await renderPdf('HyperFrames Demo', bodyHtml)
  const pptx = await renderPptx('HyperFrames Demo', [
    { type: 'cover_slide', title: 'HyperFrames Demo', subtitle: 'Test' },
    { type: 'executive_summary_paragraph', title: 'Overview', paragraphs: ['Intro', 'Detail: A, B'] },
    { type: 'dark_navy_summary', key_points: ['Test passed'] },
  ])

  await writeArtifact('demo.docx', docx)
  await writeArtifact('demo.pdf', pdf)
  await writeArtifact('demo.pptx', pptx)
  await writeArtifact('summary.json', JSON.stringify({
    runId,
    capturedAt: new Date().toISOString(),
    lengths: {
      docx: docx.length,
      pdf: pdf.length,
      pptx: pptx.length,
    },
    headers: {
      docx: toHex(docx.subarray(0, 4)),
      pdf: toHex(pdf.subarray(0, 4)),
      pptx: toHex(pptx.subarray(0, 4)),
    },
  }, null, 2))

  assert.equal(toHex(docx.subarray(0, 4)), '504b0304')
  assert.equal(toHex(pdf.subarray(0, 4)), '25504446')
  assert.equal(toHex(pptx.subarray(0, 4)), '504b0304')
  assert.ok(docx.length > 1000)
  assert.ok(pdf.length > 1000)
  assert.ok(pptx.length > 1000)
})

async function writeArtifact(name: string, content: Buffer | string): Promise<void> {
  const filePath = resolve(artifactRoot, name)
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content as string | Uint8Array)
}

function toHex(buffer: Buffer): string {
  return buffer.toString('hex')
}
