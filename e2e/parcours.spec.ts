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

  // Départ au son : le coup est à 1,0 s dans la vidéo de test (image 120 à 120 i/s)
  await page.getByRole('button', { name: 'Épreuve', exact: true }).click();
  await page.getByRole('button', { name: 'Détecter le départ' }).click();
  await expect(page.getByText(/le plus fort/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Utiliser comme départ' }).first().click();
  await expect(page.getByRole('button', { name: /^Départ img 1(19|2[0-2])$/ })).toBeVisible();

  // Supprimer un repère depuis le panneau
  await page.getByRole('button', { name: /Supprimer Passage repère/ }).first().click();
  await page.getByRole('button', { name: 'Repères', exact: true }).click();
  await expect(page.locator('.events li')).toHaveCount(2);

  // Kinogramme à partir des repères
  await page.getByRole('button', { name: 'Kinogramme', exact: true }).click();
  await page.getByRole('button', { name: /Générer/ }).click();
  await expect(page.getByRole('button', { name: 'Télécharger en PNG' })).toBeVisible({ timeout: 20_000 });

  // Rapports : deux PDF et un CSV, générés sur l'appareil
  await page.getByRole('button', { name: 'Rapports', exact: true }).click();
  for (const [button, suffix] of [['PDF athlète', 'athlete.pdf'], ['PDF coach', 'coach.pdf']] as const) {
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.getByRole('button', { name: button }).click()]);
    expect(download.suggestedFilename()).toContain(suffix);
    const path = await download.path();
    const head = (await import('node:fs')).readFileSync(path).subarray(0, 5).toString('latin1');
    expect(head).toBe('%PDF-');
  }
  const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'CSV de l’essai' }).click()]);
  expect(csv.suggestedFilename()).toMatch(/\.csv$/);

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

/** Serveur WebDAV simulé au niveau du navigateur : mêmes fichiers pour tous les « appareils » du test. */
function davRoute(files: Map<string, Buffer>, dirs: Set<string>) {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': '*', 'access-control-allow-headers': '*', 'access-control-expose-headers': '*' };
  const base = '/dav/foulee';
  return async (route: import('@playwright/test').Route) => {
    const req = route.request();
    const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const rel = decodeURIComponent(new URL(req.url()).pathname.slice(base.length)).replace(/^\//, '').replace(/\/$/, '');
    const ok = (status: number, body?: string | Buffer) => route.fulfill({ status, headers: cors, ...(body !== undefined ? { body } : {}) });
    if (method === 'MKCOL') {
      if (dirs.has(rel)) return ok(405);
      dirs.add(rel);
      return ok(201);
    }
    if (method === 'PUT') {
      files.set(rel, req.postDataBuffer() ?? Buffer.alloc(0));
      return ok(201);
    }
    if (method === 'GET' || method === 'HEAD') {
      const f = files.get(rel);
      return f ? ok(200, method === 'GET' ? f : undefined) : ok(404);
    }
    if (method === 'DELETE') {
      files.delete(rel);
      return ok(204);
    }
    if (method === 'PROPFIND') {
      if (rel !== '' && !dirs.has(rel)) return ok(404);
      const prefix = rel ? rel + '/' : '';
      const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/');
      const entry = (href: string, dir: boolean) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:resourcetype>${dir ? '<d:collection/>' : ''}</d:resourcetype></d:prop></d:propstat></d:response>`;
      const items = [entry(`${base}/${enc(prefix)}`, true)];
      for (const d of dirs) if (d && d.startsWith(prefix) && !d.slice(prefix.length).includes('/')) items.push(entry(`${base}/${enc(d)}/`, true));
      for (const f of files.keys()) if (f.startsWith(prefix) && !f.slice(prefix.length).includes('/')) items.push(entry(`${base}/${enc(f)}`, false));
      return ok(207, `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${items.join('')}</d:multistatus>`);
    }
    return ok(405);
  };
}

test('sauvegarde chiffrée sur WebDAV, puis restauration sur un nouvel appareil', async ({ browser }) => {
  const files = new Map<string, Buffer>();
  const dirs = new Set<string>(['']);
  const handler = davRoute(files, dirs);
  const URL_DAV = 'https://dav.test/dav/foulee';

  // Appareil 1 : un athlète, une destination chiffrée, une sauvegarde
  const ctx1 = await browser.newContext();
  const a = await ctx1.newPage();
  await a.route('https://dav.test/**', handler);
  await a.goto('./');
  await expect(a.getByRole('heading', { name: 'Bonjour 👋' })).toBeVisible();
  await a.getByRole('navigation').getByRole('link', { name: 'Athlètes' }).click();
  await a.getByRole('button', { name: '＋ Ajouter' }).click();
  await a.getByLabel('Prénom').fill('Léa');
  await a.getByLabel('Nom', { exact: true }).fill('Secret');
  await a.getByRole('button', { name: 'Créer' }).click();
  await expect(a.getByRole('heading', { name: /Léa Secret/ })).toBeVisible();
  await a.goto('./#/sauvegardes');
  await a.getByRole('button', { name: /Ajouter une destination/ }).click();
  await a.getByLabel('Adresse du dossier').fill(URL_DAV);
  await a.getByLabel('Phrase secrète (8 caractères minimum)').fill('phrase-secrete');
  await a.getByLabel('Confirmer').fill('phrase-secrete');
  await a.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(a.getByText('Destination ajoutée')).toBeVisible({ timeout: 20_000 });
  await a.getByRole('button', { name: 'Sauvegarder maintenant' }).click();
  await expect(a.getByText(/Sauvegarde terminée/)).toBeVisible({ timeout: 30_000 });

  // Rien de lisible sur le serveur
  const stored = [...files.entries()].filter(([k]) => k.startsWith('athletes/'));
  expect(stored.length).toBe(1);
  expect(stored[0]![1].toString('latin1')).not.toContain('Secret');
  expect(files.has('encryption.json')).toBe(true);
  await ctx1.close();

  // Appareil 2 : navigateur vierge
  const ctx2 = await browser.newContext();
  const b = await ctx2.newPage();
  await b.route('https://dav.test/**', handler);
  await b.goto('./');
  await expect(b.getByRole('heading', { name: 'Bonjour 👋' })).toBeVisible();
  await b.goto('./#/sauvegardes');
  await b.getByRole('button', { name: /Ajouter une destination/ }).click();
  await b.getByLabel('Adresse du dossier').fill(URL_DAV);
  // mauvaise phrase : refus
  await b.getByLabel('Phrase secrète (8 caractères minimum)').fill('mauvaise-phrase');
  await b.getByLabel('Confirmer').fill('mauvaise-phrase');
  await b.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(b.getByText(/phrase secrète incorrecte/)).toBeVisible({ timeout: 20_000 });
  await b.getByLabel('Phrase secrète (8 caractères minimum)').fill('phrase-secrete');
  await b.getByLabel('Confirmer').fill('phrase-secrete');
  await b.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(b.getByText('Destination ajoutée')).toBeVisible({ timeout: 20_000 });
  b.once('dialog', (d) => void d.accept());
  await b.getByRole('button', { name: 'Restaurer sur cet appareil' }).click();
  await expect(b.getByText(/Restauration terminée/)).toBeVisible({ timeout: 30_000 });
  await b.goto('./#/athletes');
  await expect(b.getByText('Léa Secret')).toBeVisible();
  await ctx2.close();
});

test('saut en longueur : gabarit, mesures et rapport', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('navigation').getByRole('link', { name: 'Athlètes' }).click();
  await page.getByRole('button', { name: '＋ Ajouter' }).click();
  await page.getByLabel('Prénom').fill('Max');
  await page.getByLabel('Nom', { exact: true }).fill('Saut');
  await page.getByRole('button', { name: 'Créer' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Séances' }).click();
  await page.getByRole('button', { name: '＋ Nouvelle séance' }).click();
  await page.locator('input[type=file]').setInputFiles([VIDEO]);
  await page.getByLabel('Athlète').selectOption({ label: 'Max Saut' });
  await page.getByLabel('Épreuve').selectOption('longueur');
  await page.getByRole('button', { name: 'Importer', exact: true }).click();
  await expect(page.getByText(/240 images · 120 i\/s/)).toBeVisible({ timeout: 20_000 });
  await page.locator('.hud-tc').click();
  await waitFrame(page, 0);

  await page.getByRole('button', { name: 'Épreuve', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Gabarit du longueur/i })).toBeVisible();

  // Appel (planche, 0 m), décollage, réception à 6,20 m
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight');
  await waitFrame(page, 20);
  await page.getByRole('button', { name: 'Appel droit' }).click();
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Décollage gauche', exact: true }).first().click();
  for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowRight');
  await page.getByLabel('Position (m) : Réception').fill('6,2');
  await page.getByRole('button', { name: 'Réception', exact: true }).click();

  await expect(page.getByText('Longueur du saut')).toBeVisible();
  await expect(page.locator('.jump table.tbl').first()).toContainText('6,20');
  await expect(page.locator('.jump table.tbl').first()).toContainText('indicatif');

  await page.getByRole('button', { name: 'Rapports', exact: true }).click();
  for (const [button, suffix] of [['PDF athlète', 'athlete.pdf'], ['PDF coach', 'coach.pdf']] as const) {
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.getByRole('button', { name: button }).click()]);
    expect(download.suggestedFilename()).toContain(suffix);
    const head = (await import('node:fs')).readFileSync((await download.path())!).subarray(0, 5).toString('latin1');
    expect(head).toBe('%PDF-');
  }
});

test('marteau : tours, gabarit et rapport', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('navigation').getByRole('link', { name: 'Athlètes' }).click();
  await page.getByRole('button', { name: '＋ Ajouter' }).click();
  await page.getByLabel('Prénom').fill('Tom');
  await page.getByLabel('Nom', { exact: true }).fill('Marteau');
  await page.getByRole('button', { name: 'Créer' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Séances' }).click();
  await page.getByRole('button', { name: '＋ Nouvelle séance' }).click();
  await page.locator('input[type=file]').setInputFiles([VIDEO]);
  await page.getByLabel('Athlète').selectOption({ label: 'Tom Marteau' });
  await page.getByLabel('Épreuve').selectOption('marteau');
  await page.getByRole('button', { name: 'Importer', exact: true }).click();
  await expect(page.getByText(/240 images · 120 i\/s/)).toBeVisible({ timeout: 20_000 });
  await page.locator('.hud-tc').click();
  await waitFrame(page, 0);

  await page.getByRole('button', { name: 'Épreuve', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Gabarit du marteau/i })).toBeVisible();
  for (const step of [0, 60, 60, 50]) {
    for (let i = 0; i < step; i++) await page.keyboard.press('ArrowRight');
    if (step === 50) await page.getByRole('button', { name: 'Lâcher', exact: true }).click();
    else await page.getByRole('button', { name: 'Début de tour', exact: true }).click();
  }
  await expect(page.locator('.throw table.tbl').first()).toContainText('Nombre de tours');
  await expect(page.locator('.throw table.tbl').nth(1)).toContainText('Tour 3');
  await expect(page.getByText(/Sans étalon/)).toBeVisible();

  await page.getByRole('button', { name: 'Rapports', exact: true }).click();
  for (const [button, suffix] of [['PDF athlète', 'athlete.pdf'], ['PDF coach', 'coach.pdf']] as const) {
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.getByRole('button', { name: button }).click()]);
    expect(download.suggestedFilename()).toContain(suffix);
    const head = (await import('node:fs')).readFileSync((await download.path())!).subarray(0, 5).toString('latin1');
    expect(head).toBe('%PDF-');
  }
});
