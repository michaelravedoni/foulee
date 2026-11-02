import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const VIDEO = fileURLToPath(new URL('./fixtures/sprint-120fps.mp4', import.meta.url));

async function canvasHash(page: Page): Promise<string> {
  return page.evaluate(() => {
    const c = document.querySelector('.player canvas') as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]!) | 0;
    return `${c.width}x${c.height}:${h}`;
  });
}

async function waitFrame(page: Page, n: number) {
  await expect(page.locator('.hud-tc')).toHaveText(`img ${n}`);
  // laisse le décodage se terminer
  await page.waitForTimeout(250);
}

test('séance complète : athlète, séance, import, image par image, dessin, comparaison, export', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Bonjour 👋' })).toBeVisible();

  // Athlète
  await page.getByRole('navigation').getByRole('link', { name: 'Athlètes' }).click();
  await page.getByRole('button', { name: '＋ Ajouter' }).click();
  await page.getByLabel('Prénom').fill('Léa');
  await page.getByLabel('Nom', { exact: true }).fill('Rey');
  await page.getByRole('button', { name: 'Créer' }).click();
  await expect(page.getByRole('heading', { name: /Léa Rey/ })).toBeVisible();

  // Séance + import
  await page.getByRole('navigation').getByRole('link', { name: 'Séances' }).click();
  await page.getByRole('button', { name: '＋ Nouvelle séance' }).click();
  await page.locator('input[type=file]').setInputFiles([VIDEO, VIDEO]);
  await page.getByLabel('Athlète').selectOption({ label: 'Léa Rey' });
  await page.getByLabel('Épreuve').selectOption('100m');
  await page.getByRole('button', { name: 'Importer', exact: true }).click();
  await expect(page.locator('.trial-row')).toHaveCount(2);

  // Lecteur image par image
  await page.locator('.trial-row .list-item').first().click();
  await expect(page.getByText(/240 images · 120 i\/s/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/WebCodecs/)).toBeVisible();
  await page.locator('.hud-tc').click(); // ms → image
  await waitFrame(page, 0);

  // Avance de 37 images une par une, puis vérifie qu'un saut direct donne la même image.
  for (let i = 0; i < 37; i++) await page.keyboard.press('ArrowRight');
  await waitFrame(page, 37);
  const stepped = await canvasHash(page);
  await page.keyboard.press('End');
  await waitFrame(page, 239);
  // Clic sur la barre : position proportionnelle, puis ajustement à l'image près au clavier.
  const sbox = (await page.locator('.scrub .track').boundingBox())!;
  await page.mouse.click(sbox.x + sbox.width * (37 / 239), sbox.y + sbox.height / 2);
  await expect(page.locator('.hud-tc')).not.toHaveText('img 239');
  const cur = Number((await page.locator('.hud-tc').innerText()).replace('img ', ''));
  expect(Math.abs(cur - 37)).toBeLessThanOrEqual(2);
  for (let i = cur; i < 37; i++) await page.keyboard.press('ArrowRight');
  for (let i = cur; i > 37; i--) await page.keyboard.press('ArrowLeft');
  await waitFrame(page, 37);
  expect(await canvasHash(page)).toBe(stepped);
  // Pas arrière
  await page.keyboard.press('ArrowLeft');
  await waitFrame(page, 36);
  expect(await canvasHash(page)).not.toBe(stepped);
  await page.keyboard.press('ArrowRight');
  await waitFrame(page, 37);
  expect(await canvasHash(page)).toBe(stepped);

  // Lecture continue : avance, ne fige pas, puis s'arrête à la pause.
  await page.keyboard.press('Home');
  await waitFrame(page, 0);
  const seen = new Set<string>();
  await page.keyboard.press('Space');
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(100);
    seen.add(await page.locator('.hud-tc').innerText());
  }
  await page.keyboard.press('Space');
  expect(seen.size).toBeGreaterThanOrEqual(4);
  await page.waitForTimeout(200);
  const paused = await page.locator('.hud-tc').innerText();
  await page.waitForTimeout(300);
  await expect(page.locator('.hud-tc')).toHaveText(paused);
  await page.keyboard.press('Home');
  await waitFrame(page, 0);
  for (let i = 0; i < 37; i++) await page.keyboard.press('ArrowRight');
  await waitFrame(page, 37);

  // Origine du temps et repère
  await page.keyboard.press('0');
  await page.keyboard.press('Shift+ArrowRight');
  await waitFrame(page, 10);
  await page.locator('.hud-tc').click(); // image → h:m:s
  await expect(page.locator('.hud-tc')).toHaveText('0:00,083');
  await page.getByRole('button', { name: 'Départ', exact: true }).click();
  await expect(page.locator('.events li')).toHaveCount(1);

  // Dessin : une ligne, annuler, rétablir
  await page.getByRole('button', { name: 'Ligne' }).click();
  const stage = page.locator('.stage');
  const box = (await stage.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('svg.draw path')).toHaveCount(1);
  await page.getByRole('button', { name: 'Annuler' }).click();
  await expect(page.locator('svg.draw path')).toHaveCount(0);
  await page.getByRole('button', { name: 'Rétablir' }).click();
  await expect(page.locator('svg.draw path')).toHaveCount(1);

  // Tag rapide
  await page.getByRole('button', { name: 'essai valide' }).click();
  await expect(page.getByRole('button', { name: 'essai valide' })).toHaveAttribute('aria-pressed', 'true');

  // Les données survivent à un rechargement (coffre OPFS)
  await page.waitForTimeout(600);
  await page.reload();
  // Le lecteur rouvre sur t = 0 (image 37) ; le dessin est ancré à l'image 47.
  await expect(page.locator('.hud-tc')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(300);
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.locator('svg.draw path')).toHaveCount(1);
  await expect(page.locator('.events li')).toHaveCount(1);

  // Mesures : étalon de 10 m, longueur calibrée, trajectoire, chrono par sections
  page.once('dialog', (d) => void d.accept('10'));
  await page.getByRole('button', { name: /Étalon/ }).click();
  const sb = (await page.locator('.stage').boundingBox())!;
  await page.mouse.move(sb.x + sb.width * 0.2, sb.y + sb.height * 0.8);
  await page.mouse.down();
  await page.mouse.move(sb.x + sb.width * 0.6, sb.y + sb.height * 0.8, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('svg.draw .etalon text')).toContainText('10');
  await expect(page.locator('svg.draw text', { hasText: /± .* m$/ })).toHaveCount(1); // la ligne porte sa longueur en mètres
  await page.getByRole('button', { name: /Trajectoire/ }).click();
  for (let i = 0; i < 3; i++) {
    await page.mouse.click(sb.x + sb.width * (0.3 + 0.05 * i), sb.y + sb.height * 0.4);
  }
  await page.getByRole('button', { name: 'Mesures', exact: true }).click();
  await expect(page.getByText(/Trajectoire 1 · 3 points/)).toBeVisible();
  await expect(page.getByText(/px\/m, incertitude/)).toBeVisible();
  await page.getByRole('button', { name: 'Repères', exact: true }).click();
  await page.getByRole('button', { name: 'Arrivée', exact: true }).click();
  await page.getByRole('button', { name: 'Mesures', exact: true }).click();
  await expect(page.locator('table.sections tbody tr')).toHaveCount(1);
  await expect(page.locator('table.sections tbody tr td.mono').first()).toContainText('±');

  // Épreuve : splits d'un 100 m avec contrôles de plausibilité
  await page.getByRole('button', { name: 'Épreuve', exact: true }).click();
  await page.getByRole('button', { name: '30 m', exact: true }).click();
  await expect(page.locator('.sprint table.tbl').first()).toBeVisible();
  await expect(page.locator('.sprint .checks')).toContainText('improbable'); // 30 m en quelques images : le moteur alerte
  await page.getByRole('button', { name: '30 m' }).click(); // remplace, ne duplique pas
  await page.getByRole('button', { name: 'Repères', exact: true }).click();
  await expect(page.locator('.events li')).toHaveCount(3); // départ, arrivée, un seul 30 m

  // Comparaison côte à côte
  await expect(page.getByRole('link', { name: 'Comparer au précédent' })).toBeVisible();
  await page.goto('./#/seances');
  await page.locator('.list-item').first().click();
  const boxes = page.locator('.trial-row input[type=checkbox]');
  await expect(boxes).toHaveCount(2);
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page.getByRole('button', { name: /Comparer la sélection \(2\)/ }).click();
  await expect(page.locator('.pane')).toHaveCount(2);
  await expect(page.locator('.pane .hud-tc').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: '⇆ Synchroniser ici' }).click();
  await page.getByRole('button', { name: 'Image suivante' }).first().click();
  await page.waitForTimeout(400);
  await expect(page.locator('.pane .mono.small').nth(0)).toContainText('décalage 1 img');
  await expect(page.locator('.pane .mono.small').nth(1)).toContainText('décalage 1 img');

  // Export du coffre
  await page.goto('./#/coffre');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exporter sans les vidéos' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^foulee-coffre-.*-sans-videos\.zip$/);
});

test('fonctionne hors-ligne après le premier chargement', async ({ page, context }) => {
  await page.goto('./');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload(); // le service worker contrôle maintenant la page
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Bonjour 👋' })).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Replay' }).click();
  await expect(page.getByRole('heading', { name: 'Replay différé' })).toBeVisible();
  await context.setOffline(false);
});

test('le mode Terrain ne casse pas la mise en page', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Bonjour 👋' })).toBeVisible();
  await page.getByRole('button', { name: 'Analyse' }).click();
  await expect(page.getByRole('button', { name: 'Terrain' })).toBeVisible();
  const width = await page.evaluate(() => [innerWidth, document.documentElement.getBoundingClientRect().width]);
  expect(width[1]).toBe(width[0]);
  // le mode persiste après rechargement
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Bonjour 👋' })).toBeVisible();
  const again = await page.evaluate(() => [innerWidth, document.documentElement.getBoundingClientRect().width, document.documentElement.getBoundingClientRect().height]);
  expect(again[1]).toBe(again[0]);
  expect(again[2]).toBeGreaterThan(100);
});

test('si OPFS ne répond pas, le coffre bascule sur IndexedDB et fonctionne', async ({ page }) => {
  await page.addInitScript(() => {
    // Simule un profil Safari où OPFS ne répond jamais.
    Object.defineProperty(navigator.storage, 'getDirectory', { value: () => new Promise(() => undefined) });
  });
  await page.goto('./#/athletes');
  await expect(page.getByText(/IndexedDB à la place/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: '＋ Ajouter' }).click();
  await page.getByLabel('Prénom').fill('Zoé');
  await page.getByRole('button', { name: 'Créer' }).click();
  await expect(page.getByRole('heading', { name: /Zoé/ })).toBeVisible();
  await page.reload();
  await page.goto('./#/athletes');
  await expect(page.getByText('Zoé')).toBeVisible({ timeout: 15_000 });
});
