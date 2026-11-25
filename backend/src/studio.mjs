// Routes métier de SAYLESS STUDIO, appelées par admin.mjs une fois la session vérifiée.
// Lecture : session valide. Écriture sensible (stock, argent, réglages, données personnelles) :
// confirmation Face ID de moins de 5 minutes (requireStepUp). Tout est journalisé.
import { fail, getSettings, json } from './lib.mjs';
import { readJson } from './security.mjs';
import { inventorySnapshot, recordInventory } from './stock.mjs';

const REFERENCE_TOTAL = 26; // déclaration théorique du DROP 01, jamais imposée au stock

async function inventoryView(ctx) {
  const rows = await inventorySnapshot(ctx.db);
  const settings = await getSettings(ctx.db);
  return { variants: rows.map((r) => ({ sku: r.sku, size: r.size, on_hand: r.on_hand, reserved: r.reserved, available: r.available,
    confirmed: r.confirmed_at !== null, revision: r.revision })), reference_total: REFERENCE_TOTAL,
  low_stock_threshold: Number(settings.low_stock_threshold || 2) };
}

export async function handleStudio(request, ctx, { route, requireStepUp, now }) {
  switch (route) {
    // ---- inventaire guidé ----
    case 'GET /api/admin/inventory':
      return json(await inventoryView(ctx));
    case 'POST /api/admin/inventory': {
      const body = await readJson(request);
      requireStepUp();
      const counts = body.counts ?? {};
      const aside = body.set_aside ?? {};
      for (const v of [...Object.values(counts), aside.unshipped ?? 0, aside.promised ?? 0, aside.damaged ?? 0]) {
        if (!Number.isSafeInteger(v) || v < 0 || v > 10000) throw fail('invalid_request');
      }
      const counted = Object.values(counts).reduce((n, v) => n + v, 0);
      const gap = counted + (aside.promised ?? 0) + (aside.damaged ?? 0) - REFERENCE_TOTAL;
      const note = `Inventaire guidé : à vendre ${counted} ; payées non expédiées ${aside.unshipped ?? 0} ; promises ${aside.promised ?? 0} ; abîmées ${aside.damaged ?? 0} ; écart avec ${REFERENCE_TOTAL} théoriques ${gap >= 0 ? '+' : ''}${gap}.`;
      await recordInventory(ctx.db, { counts, expected: body.expected ?? {}, actor: 'fondateur', note, now });
      return json({ ...(await inventoryView(ctx)), gap, stripe_limit_proposal: 2 + counted });
    }
    default:
      return json({ error: 'not_found' }, 404);
  }
}
