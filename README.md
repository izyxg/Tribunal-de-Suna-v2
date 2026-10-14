# Tribunal de Sunagakure v2

Application RP pour gérer le tribunal : membres, rôles, liens d'invitation, trésorerie, jugements, tâches et audit.

Cette version n'utilise plus `localStorage` comme base principale. Toutes les données importantes sont enregistrées dans PostgreSQL via les fonctions API Vercel.

## Ce qui a changé

- Backend Vercel `/api` relié à PostgreSQL.
- Initialisation du gérant persistante : elle reste après redémarrage/redéploiement.
- Sessions avec cookie HTTP-only.
- Mots de passe protégés avec PBKDF2 + sel unique.
- Système d'invitation par lien : `/invite/<token>` et `/i/<token>`.
- Tokens d'invitation stockés uniquement sous forme hashée en base.
- Permissions serveur par grade, pas seulement masquées côté interface.
- Audit des actions sensibles.
- Export JSON réservé au gérant.
- Interface refaite et plus responsive.

## Variables d'environnement Vercel

Dans Vercel, ajoute une variable d'environnement en Production, Preview et Development :

```txt
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DB?sslmode=require
```

Le code accepte aussi `POSTGRES_URL`, `POSTGRES_PRISMA_URL` ou `POSTGRES_URL_NON_POOLING`, mais `DATABASE_URL` est recommandé.

Ne mets jamais l'URL PostgreSQL dans le frontend. Elle doit rester dans les variables d'environnement Vercel.

## Déploiement Vercel

1. Pousse le repo sur GitHub.
2. Importe le repo dans Vercel.
3. Ajoute la variable `DATABASE_URL` dans les Environment Variables.
4. Redéploie.
5. Ouvre le site : la première page demande de créer le compte Gérant.

## Utilisation

### Première connexion

Au premier lancement avec une base vide, l'application affiche l'écran d'initialisation. Le premier compte créé devient automatiquement `Gérant`.

### Invitations

Un gérant ou co-gérant peut aller dans l'onglet `Invitations`, choisir un grade, puis générer un lien. Le joueur reçoit le lien, choisit son mot de passe et son compte est créé.

Formats supportés :

- `/invite/<token>`
- `/i/<token>`
- `/?invite=<token>`

Le lien n'est affiché qu'au moment de sa création. Si tu le perds, révoque l'invitation et génère un nouveau lien.

Un co-gérant ne peut pas créer de gérant ni de co-gérant. Le gérant reste le seul rôle maximal.

### Trésorerie

Les dépôts ajoutent automatiquement 10 % en commission/paye du membre et 90 % au trésor. Les retraits sont réservés aux rôles de gestion.

## Développement local

Installe les dépendances :

```bash
npm install
```

Crée un fichier `.env` ou lance avec une variable d'environnement :

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DB?sslmode=require" npx vercel dev
```

Puis ouvre l'URL indiquée par Vercel.
