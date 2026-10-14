# Tribunal de Suna — Justice

Application web statique pour gérer un tribunal RP Naruto : membres, grades, trésorerie, jugements, tâches et audit.

## Améliorations ajoutées

- Login propre avec identifiants uniques.
- Premier démarrage avec création du compte **Gérant**.
- Activation des membres par **code d'invitation**.
- Mots de passe protégés côté navigateur avec **PBKDF2 + sel unique** via Web Crypto.
- Blocage temporaire après trop de tentatives de connexion.
- Sessions limitées à 8 heures via `sessionStorage`.
- Rôles et permissions : Gérant, Co-gérant, Magistrat, Greffier, Procureur, Avocat, Auditeur.
- Audit des actions sensibles.
- Export / import JSON pour sauvegarder les données.
- Interface séparée en fichiers `index.html`, `assets/styles.css`, `assets/app.js`.
- Optimisation : plus de gros fichier unique, script différé, CSS séparé, rendu plus clair.

## Lancer en local

Ouvre le dossier avec VS Code, puis lance Live Server sur `index.html`.

Tu peux aussi ouvrir directement `index.html`, mais le hash sécurisé des mots de passe demande un contexte sécurisé. Utilise de préférence :

- `https://` en ligne ;
- ou `localhost` en développement.

## Déploiement Vercel

Framework preset : **Other**

Aucune commande de build nécessaire.

## Important sécurité

Cette version améliore fortement le login par rapport à un simple mot de passe en clair ou hash simple, mais le projet reste une application statique. Les données sont stockées dans le navigateur avec `localStorage`.

Pour un vrai usage multi-utilisateur partagé entre plusieurs personnes, il faudra ajouter un backend et une base de données serveur, par exemple :

- Next.js + API routes ;
- Prisma + PostgreSQL ;
- Auth serveur avec cookies HttpOnly ;
- rôles vérifiés côté serveur.

Cette version est donc parfaite pour un registre local ou une base à déployer rapidement, mais pas pour protéger des données sensibles réelles.

## Migration depuis l'ancienne version

Au premier lancement, l'application essaie de récupérer les anciennes clés `tsr_members`, `tsr_treasury`, `tsr_judgments` et `tsr_tasks` si elles existent dans le navigateur.

Les anciens mots de passe sont migrés automatiquement vers PBKDF2 après une connexion réussie.
