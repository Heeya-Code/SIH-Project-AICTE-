const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function run() {
  const dir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  await page.setViewport({ width: 1440, height: 900 });

  console.log('Navigating to dashboard test change verification...');
  await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle2' });

  // Click Administrator demo account & sign in
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const adminBtn = btns.find(b => b.textContent.includes('Administrator'));
    if (adminBtn) adminBtn.click();
  });
  await new Promise(r => setTimeout(r, 500));
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button[type="submit"]'));
    if (btns[0]) btns[0].click();
  });
  await new Promise(r => setTimeout(r, 2000));

  await page.screenshot({ path: path.join(dir, 'test-change-navy-sidebar-1440.png'), fullPage: true });
  await browser.close();
  console.log('Test change screenshot taken successfully.');
}

run().catch(err => {
  console.error('Test change screenshot error:', err);
  process.exit(1);
});
