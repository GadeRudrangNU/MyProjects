import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import gifenc from 'gifenc'
import { PNG } from 'pngjs'
import type { Page } from '@playwright/test'

const { applyPalette, GIFEncoder, quantize } = gifenc

interface Frame {
  png: Buffer
  delay: number
}

export class Recorder {
  private frames: Frame[] = []

  constructor(private readonly name: string) {}

  async snap(page: Page, caption: string, delay = 1600) {
    await page.evaluate((text) => {
      let bar = document.getElementById('demo-caption')
      if (!bar) {
        bar = document.createElement('div')
        bar.id = 'demo-caption'
        bar.style.cssText =
          'position:fixed;left:0;right:0;bottom:0;z-index:99999;padding:10px 16px;background:#16213a;color:#fff;font:600 15px system-ui,sans-serif;text-align:center'
        document.body.appendChild(bar)
      }
      bar.textContent = text
    }, caption)
    await page.waitForTimeout(250)
    this.frames.push({ png: await page.screenshot(), delay })
  }

  save() {
    const dir = path.resolve(process.cwd(), '..', 'docs', 'gifs')
    mkdirSync(dir, { recursive: true })
    const encoder = GIFEncoder()
    for (const frame of this.frames) {
      const image = PNG.sync.read(frame.png)
      const palette = quantize(image.data, 256)
      encoder.writeFrame(applyPalette(image.data, palette), image.width, image.height, { palette, delay: frame.delay })
    }
    encoder.finish()
    writeFileSync(path.join(dir, `${this.name}.gif`), encoder.bytes())
  }
}
