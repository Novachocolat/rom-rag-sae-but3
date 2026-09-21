# Sprint n°1 - Socle technique, schéma de données, authentification

Ce sprint ne produit aucune fonctionnalité ROM visible, et c'est voulu. Il pose
les quatre fondations sans lesquelles tout le reste sera à réécrire :

1. **Le schéma de données :** On écrit les tables (ROMs, entrées DAT,
   propositions IA, collections, embeddings, jobs de scan). Écrire le schéma
   oblige aussi l'équipe à se mettre d'accord sur le vocabulaire du domaine dès
   le premier jour.

2. **La configuration externalisée :** Aucune URL d'inférence, nom de modèle ou
   hyperparamètre en dur. On ajoute tous les `OLLAMA_*` avant d'écrire le
   wrapper IA.

3. **La robustesse HTTP :** Une exception dans une route renvoie une page HTML
   avec la stack trace. On met en place une enveloppe d'erreur JSON unique et
   les middlewares nécessaires.

4. **L'authentification :** Chaque ROM appartient à un utilisateur, donc chaque
   route ultérieure en dépend. À la fin du sprint, on peut créer un compte, se
   connecter, et voir une page « Bibliothèque » vide, sans collections de jeux
   vidéo pour l'instant.

## US1.1 — Schéma de données

- **EN TANT QUE** développeur backend
- **JE SOUHAITE** disposer d'un schéma Prisma couvrant ROMs, catalogues DAT,
  propositions IA, collections de jeux, embeddings et jobs de scan
- **AFIN QUE** les migrations suivantes soient fluides et la base de données
  claire pour l'ensemble de l'équipe de développement
- **Priorité :** 🔴 Bloquante — le backend en dépend
- **Responsable :** Neda (A/R) · David (R, revue du modèle) · Lysandre (C)

### DoR

- L'équipe de développement ont relu et validé la liste des tables.

### DoD

- `npm run db:generate` et `npm run db:migrate` passent sur une base neuve
  (`npm run docker:dev:reset`).
- `docs/DATA_MODEL.md` contient un diagramme Mermaid à jour et un paragraphe
  expliquant chaque enum.
- L'ADR-007 passe de `Proposed` à `Accepted`.

---

## US1.2 — Configuration externalisée et infrastructure Ollama

- **EN TANT QU'** évaluateur
- **JE SOUHAITE** pouvoir changer de modèle, d'URL d'inférence ou
  d'hyperparamètre sans toucher au code
- **AFIN QUE** le projet soit reproductible
- **Priorité :** 🔴 Bloquante
- **Responsable :** Lysandre (A/R) · David (C)

### DoR

- L'instance Ollama est joignable et les deux modèles sont listés par `curl`.
  Consigner la sortie dans les notes rapides Notion.

### DoD

- `npm run docker:dev` démarre avec les nouvelles variables ; le backend refuse
  de démarrer (fail fast, pas de valeur par défaut) si une seule variable
  manque, et le message d'erreur Zod nomme la variable fautive.
- `docker compose config --quiet` passe (job `docker-build` de la CI).

---

## US1.3 — Robustesse HTTP : erreurs, validation, journalisation

- **EN TANT QUE** consommateur de l'API
- **JE SOUHAITE** recevoir une enveloppe JSON d'erreur unique et prévisible,
  quelle que soit la panne
- **AFIN QUE** le frontend puisse afficher un message utile plutôt qu'une page
  HTML de stack trace
- **Priorité :** 🔴 Bloquante
- **Responsable :** David (A/R) · Neda (C) · Lysandre (I)

### DoR

- L'enveloppe d'erreur est validée par Neda et Lysandre (elle contraint le
  client API).

### DoD

- Une route de test qui `throw` renvoie du JSON conforme aux schémas établis.
- `GET /api/inexistant` renvoie 4004 JSON.
- Un `ZodError` renvoie 400 avec `details` exploitable.
- Aucune stack trace n'apparaît dans une réponse HTTP en `NODE_ENV=production`.

---

## US1.4 — Authentification par session

- **EN TANT QU'** utilisateur
- **JE SOUHAITE** créer un compte, me connecter et me déconnecter
- **AFIN QUE** ma bibliothèque de ROMs et mes validations de propositions IA me
  soient personnelles
- **Priorité :** 🟠 Haute
- **Responsable :** Neda (A/R) · Lysandre (C) · David (I)

### DoR

- US1.1 et US1.3 terminées.

### DoD

- Tests co-localisés couvrant : signup nominal, signup email dupliqué (409),
  login nominal, login mauvais mot de passe (401), `/me` sans cookie (401),
  `/me` avec cookie (200), logout invalidant réellement la session Redis.

* Le hash Argon2 est vérifié comme n'étant jamais présent dans une réponse HTTP.

---

## US1.5 — Ossature du frontend

- **EN TANT QUE** développeur frontend
- **JE SOUHAITE** un routeur, les provideurs React Query et Redux, un layout et
  un client API typé
- **AFIN QUE** chaque page suivante se réduise à un composant et un hook
- **Priorité :** 🔴 Bloquante côté frontend
- **Responsable :** David (A/R)

### DoD

- On peut créer un compte, se connecter, être redirigé vers `/`, rafraîchir la
  page sans être déconnecté, et se déconnecter.
- Aucune classe Tailwind concaténée à la main : passage par `cn()`.

---

## US1.6 — Dette documentaire et outillage

- **EN TANT QU'** évaluateur
- **JE SOUHAITE** que la documentation décrive le système réel
- **AFIN QUE** l'écart entre les ADR et le code ne soit pas relevé
- **Priorité :** 🟡 Moyenne
- **Responsable :** David (A/R) · Neda (R) · Lysandre (R)

### DoD

- `docs/ARCHITECTURE.md` et `docs/DATA_MODEL.md` ne contiennent plus de
  commentaire ; le `CHANGELOG.md` porte une entrée datée du sprint.
