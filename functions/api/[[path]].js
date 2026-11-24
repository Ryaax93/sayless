// Cloudflare Pages Function : toute l'API publique de la boutique, sur la même origine (/api/*).
// Le code métier est dans backend/src ; ce fichier ne fait que le brancher.
import catalog from '../../data/products.json';
import { handlePublicApi } from '../../backend/src/routes.mjs';

export const onRequest = ({ request, env }) => handlePublicApi(request, env, { catalog });
