# Festival Déclic

Site vitrine du Festival Déclic — site statique (HTML/CSS) publié sur
[festivaldeclic.com](https://festivaldeclic.com) via **Cloudflare Pages** et **GitHub Actions**.

## Déploiement

Chaque `push` sur la branche `main` déclenche le workflow
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) qui publie la
racine du dépôt sur Cloudflare Pages (projet `festival-declic`).

### Secrets GitHub requis

| Secret | Description |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Token API Cloudflare avec la permission *Cloudflare Pages → Edit* |
| `CLOUDFLARE_ACCOUNT_ID` | ID du compte Cloudflare |

## Développement local

Aucune dépendance ni build. Ouvrir `index.html` dans un navigateur, ou servir le dossier :

```bash
python3 -m http.server 8000
```
