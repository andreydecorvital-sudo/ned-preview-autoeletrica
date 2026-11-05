import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.cwd());
const output = resolve(root, 'output/visual');
await mkdir(output, { recursive: true });
const results = [];
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const pages = [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ];
  for (const size of pages) {
    const page = await browser.newPage({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
    });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(pathToFileURL(resolve(root, 'index.html')).href, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: resolve(output, size.name + '.png'), fullPage: true });
    const inspect = await page.evaluate(() => {
      const invalidAnchors = Array.from(document.querySelectorAll('a[href^="#"]'))
        .map(a => a.getAttribute('href'))
        .filter(h => h && h !== '#' && !document.getElementById(h.slice(1)));
      const images = Array.from(document.images);
      return {
        title: document.title,
        h1: document.querySelector('h1')?.textContent?.trim() || '',
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        invalidAnchors,
        images: images.length,
        brokenImages: images.filter(img => !img.complete || img.naturalWidth === 0).length,
      };
    });
    const problems = [
      ...(!inspect.h1 ? ['Missing H1'] : []),
      ...(inspect.scrollWidth > inspect.viewportWidth + 2 ? ['Horizontal overflow'] : []),
      ...(inspect.invalidAnchors.length ? ['Broken in-page anchors'] : []),
      ...(inspect.brokenImages ? ['Broken image(s)'] : []),
      ...pageErrors,
    ];
    results.push({ viewport: size, ...inspect, problems });
    await page.close();
  }
} catch (error) {
  results.push({ fatalError: String(error) });
} finally {
  if (browser) await browser.close();
  await writeFile(resolve(output, 'report.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    note: 'Automated checks cannot certify visual design quality; review the screenshots manually.',
    results,
  }, null, 2));
}
if (results.some(r => r.fatalError || r.problems?.length)) {
  console.error(JSON.stringify(results, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(results, null, 2));
}
