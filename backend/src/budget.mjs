// Budget d'une invocation Cloudflare sur l'offre gratuite : 50 requêtes D1 (un lot compte pour une
// seule requête) et 50 appels externes (Stripe, Resend, Discord, notifications push). Au-delà,
// Cloudflare interrompt l'invocation au milieu d'un traitement. Les tâches comptées ne commencent
// une unité de travail (une commande, un e-mail, un message) que si son coût maximal tient dans ce
// qui reste ; la suite attend la minute suivante. La réserve garde de quoi écrire le battement de
// la tâche planifiée. Le plafond strict n'est qu'un filet : il lève BudgetExhausted avant
// d'atteindre la limite de Cloudflare.
export const FREE_PLAN = Object.freeze({ queries: 50, external: 50 });

// Coût maximal d'une unité de travail : pire cas mesuré plus une marge (tests R17, R18 et U11).
// Vente rattrapée par le balayage : 24 requêtes ; e-mail en échec avec alerte : 7 ; message en échec
// définitif avec alerte : 5 ; vente 1.0 qui épuise le drop (alertes de stock) : 17. Un message push
// coûte en plus 5 requêtes (abonnements, jeton VAPID lu puis renouvelé, résultats, réponses
// tardives), puis une requête (tentative réservée) et un appel par appareil abonné (test N25).
// Retrait d'un ancien webhook Discord avant les envois : 2 requêtes au plus par invocation.
export const COST = Object.freeze({
  sweepOrder: { queries: 30, external: 3 },
  mailIntent: { queries: 8 },
  outboxMessage: { queries: 6, external: 1 },
  legacySale: { queries: 20, external: 1 },
  pushMessage: { queries: 5 },
  pushDevice: { queries: 1, external: 1 },
  discordReconcile: { queries: 2 },
  dailyReport: { queries: 10 },
  relayReminder: { queries: 2 },
  retention: { queries: 4 },
});

// Hors invocation comptée (boutique, STUDIO, tests ciblés) : aucune limite appliquée ici.
export const fits = (deps, cost) => !deps?.budget || deps.budget.allows(cost);

export class BudgetExhausted extends Error {
  constructor(kind) {
    super(`budget_${kind}`);
    this.code = 'budget_exhausted';
  }
}

export function createBudget({ queries = FREE_PLAN.queries, external = FREE_PLAN.external, reserve = 0 } = {}) {
  const used = { queries: 0, external: 0 };
  let final = false;
  const ceiling = { queries: () => queries - (final ? 0 : reserve), external: () => external };
  return {
    used,
    take(kind) {
      if (used[kind] >= ceiling[kind]()) throw new BudgetExhausted(kind);
      used[kind] += 1;
    },
    // Le coût maximal d'une unité de travail tient-il dans le reste (réserve exclue) ?
    allows({ queries: q = 0, external: e = 0 } = {}) {
      return used.queries + q <= queries - reserve && used.external + e <= external;
    },
    // Dernières écritures de l'invocation : la réserve devient utilisable.
    finish() {
      final = true;
    },
  };
}

// Échec comme le ferait D1 : promesse rejetée, jamais d'exception synchrone.
const guarded = (budget, kind, run) => {
  try {
    budget.take(kind);
  } catch (error) {
    return Promise.reject(error);
  }
  return run();
};

const INNER = Symbol('instruction D1');
// Liaison D1 comptée, même interface pour le code métier (prepare/bind/first/all/run/raw, batch).
export function meteredDb(db, budget) {
  const statement = (stmt) => ({
    [INNER]: stmt,
    bind: (...args) => statement(stmt.bind(...args)),
    first: (...args) => guarded(budget, 'queries', () => stmt.first(...args)),
    all: (...args) => guarded(budget, 'queries', () => stmt.all(...args)),
    run: (...args) => guarded(budget, 'queries', () => stmt.run(...args)),
    raw: (...args) => guarded(budget, 'queries', () => stmt.raw(...args)),
  });
  return {
    prepare: (text) => statement(db.prepare(text)),
    batch: (stmts) => guarded(budget, 'queries', () => db.batch(stmts.map((s) => s[INNER] ?? s))),
  };
}

// Appel réseau compté (fetch de Stripe, Resend, Discord et des services de notification).
export const meteredTransport = (transport, budget) => (...args) => guarded(budget, 'external', () => transport(...args));

// Client ou expéditeur fourni tout fait (tests) : un appel de méthode = un appel externe.
export function meteredClient(client, budget) {
  return new Proxy(client, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? (...args) => guarded(budget, 'external', () => value.apply(target, args)) : value;
    },
  });
}
