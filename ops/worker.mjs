// Worker d'exploitation SAYLESS : webhooks Stripe, tâches planifiées (chaque minute) et, plus tard,
// l'API et l'application SAYLESS STUDIO. Même base D1 et même code métier que la boutique.
import { handleOps, runScheduled } from '../backend/src/routes.mjs';

export default {
  fetch: (request, env) => handleOps(request, env),
  scheduled: (_controller, env, ctx) => ctx.waitUntil(runScheduled(env)),
};
