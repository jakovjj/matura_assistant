const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = new URL('/assets/beta/index.html', process.env.BETA_ORIGIN || 'http://127.0.0.1:8080').href;
  await page.goto(base + '?predmet=Engleski%20jezik&razina=A&q=2024', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.beta-exam');
  assert.equal(await page.locator('.beta-filters, .beta-count').count(), 0);
  assert.equal(await page.locator('.beta-exam').count(), await page.evaluate(() => subjectExams('Engleski jezik').length));
  assert.equal(new URL(page.url()).searchParams.has('q'), false);
  assert.equal(await page.locator('.practice-filters .grade-thresholds').count(), 1);
  assert.equal(await page.locator('.beta-exam .grade-thresholds').count(), 0);
  await page.screenshot({ path: '/tmp/maturko-beta-sidebar.png' });
  await page.locator('[data-year-link="2024"]').click();
  assert.match(page.url(), /#year-2024$/);
  const exam = page.locator('#exam-engleski-jezik-2024-ljetni-rok-a');
  await exam.locator('a.primary-button').first().click();
  await page.waitForSelector('.solver-header, .reading-practice-layout, .reading-task, .task-card');
  await page.locator('a[href*="beta/index.html"][href*="predmet="]').first().click();
  await page.waitForSelector('.beta-exam');
  assert.match(page.url(), /#exam-engleski-jezik-2024-ljetni-rok-a$/);
  await exam.locator('[data-simulation-start-link]').first().click();
  await page.waitForSelector('[data-simulation-confirm]');
  assert.match(await page.locator('.simulation-start-dialog').innerText(), /70/);
  await page.goto(base + '?predmet=Hrvatski%20jezik', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.beta-exam');
  assert.match(await page.locator('.practice-filters .grade-thresholds').innerText(), /zasebne minimalne pragove/);
  await page.evaluate(async () => { for (const subject of allSubjects) await ensureSolverData(solverKeysForSubject(subject)); });
  const totals = await page.evaluate(() => {
    let count = 0, statistics = 0;
    for (const subject of allSubjects) {
      const list = subjectExams(subject);
      const expected = JSON.stringify(gradeThresholds(list[0]));
      for (const exam of list) {
        if (JSON.stringify(gradeThresholds(exam)) !== expected || gradeThresholdNote(exam) !== gradeThresholdNote(list[0])) throw Error('Different thresholds: ' + exam.id);
        const node = document.createElement('div'); node.innerHTML = renderBetaExam(exam, []);
        if (node.querySelectorAll('.beta-part').length !== interactiveParts(exam).length) throw Error('Missing parts');
        const original = document.createElement('div'); original.innerHTML = renderExamStatistics(exam);
        if (original.firstElementChild) {
          statistics++;
          if (node.querySelector('.exam-statistics')?.outerHTML !== original.firstElementChild.outerHTML) throw Error('Missing statistics');
        }
        count++;
      }
    }
    return { exams: count, statistics };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.beta-exam');
  await page.locator('.beta-subject-grades > summary').click();
  assert.equal(await page.locator('.practice-filters .grade-thresholds').isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: '/tmp/maturko-beta-sidebar-mobile.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: sidebar thresholds, removed filters, return navigation, simulation dialog, mobile layout, metadata', totals);
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
