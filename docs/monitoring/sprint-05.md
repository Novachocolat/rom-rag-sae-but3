## Sprint 5 — Recherche, observabilité, résilience

Les fonctionnalités sont là ; ce sprint les rend **démontrables et
défendables**. Trois axes :

- **La recherche**, en deux modes : lexical (rapide, exact) et sémantique
  (pgvector, sur le vecteur de la requête). Proposer les deux et laisser
  l'utilisateur choisir.
- **L'observabilité**, explicitement notée : temps d'inférence, tokens/seconde,
  score de similarité cosinus brut, taux de succès du cache. Ces chiffres
  doivent apparaître **dans l'interface**, pas seulement dans les logs.
- **La résilience**, sous forme de tests écrits pour chaque mode de panne.

Ce que les sprints précédents ont déjà posé, et que ce sprint **réutilise sans
le réécrire** :

- `listRoms` filtre déjà par texte (titre et nom de fichier), plateforme et
  source d'identification, avec pagination par décalage.
- `findNearest`, `getMemberSimilarities` et `assertHnswIndexPresent` vivent dans
  `embedding.storage.ts`, seul fichier autorisé à porter du SQL brut.
- Le client Ollama renvoie déjà durée, tokens et tokens/s ; `AiProposal` stocke
  la durée et les tokens de chaque appel (identification **et** regroupement).
- Les six classes d'erreur Ollama, `GET /api/health` et la page `/settings` (qui
  contient déjà le `HealthPanel`) existent.

---

## US-5.1 — Recherche et filtres

- **EN TANT QU'** utilisateur
- **JE SOUHAITE** retrouver une ROM par son nom ou par son sens
- **AFIN QUE** je n'aie pas à parcourir toute ma bibliothèque
- **Priorité :** 🟠 Haute
- **Responsable :** Neda (A/R, lexical) · Lysandre (R, sémantique) · David (R,
  UI)

### DoR

- L'US-4.1 et 4.2 sont closes.
- Le texte vectorisé d'une ROM identifiée par catalogue se réduit au titre, à la
  plateforme et à l'année : les catalogues ne donnent ni éditeur ni genre.
- Le jeu de test contient assez de titres proches pour que le classement soit
  discriminant (les cinq SNES et les cinq MegaDrive y suffisent).

### DoD

- `listRoms` accepte en plus : plage d'années, appartenance à une collection,
  doublon ou non, et un tri. La pagination par **décalage** est conservée, comme
  dans toutes les listes `{ data, pagination }`.
- `search.service.ts` arbitre entre `mode: 'lexical'` (SQL) et
  `mode: 'semantic'` (vectorise la requête via `EmbeddingClient`, puis kNN
  pgvector). **Ollama indisponible : repli automatique sur le lexical** et
  `degraded: true` dans la réponse.
- `SearchBar` (bascule lexical/sémantique, score par résultat, bandeau en mode
  dégradé) est rangée avec les composants de bibliothèque ; `components/ui/` ne
  contient que les primitives shadcn.
- Test automatisé : une recherche sémantique de
  `"jeu de plateforme avec un plombier"` remonte les Mario de la bibliothèque de
  démonstration (test d'intégration opt-in, comme les autres).
- Test automatisé : Ollama éteint, la recherche bascule en lexical et le dit.
- Test automatisé : la recherche ne renvoie jamais la ROM d'un autre
  utilisateur.

---

## US-5.2 — Métriques et observabilité

- **EN TANT QU'** utilisateur
- **JE SOUHAITE** voir ce que coûte et ce que vaut chaque appel au modèle
- **AFIN QUE** la maîtrise de l'infrastructure IA soit démontrable
- **Priorité :** 🟠 Haute
- **Responsable :** David (A/R) · Lysandre (R)

### DoR

- Les mesures existent **à la source** : le client renvoie `durationMs`,
  `promptTokens`, `completionTokens` et `tokensPerSecond`, et la conversion
  nanosecondes → millisecondes est testée.
- L'US-4.3 fournit l'interface de revue des propositions et des collections IA.

### DoD

- `MetricsPanel` dans `/settings` : modèles actifs, dimension d'embedding,
  fenêtre de contexte, température, mode _thinking_, seuil de confiance, durée
  moyenne d'inférence, tokens/s, taux de cache, nombre de vecteurs indexés. **La
  configuration affichée est lue depuis `env` côté serveur, jamais écrite en
  dur.**
- `InferenceMeta` sous chaque sortie IA (proposition d'identification,
  collection proposée) : modèle, version de prompt, durée, tokens/s, cache
  oui/non.
- Chaque résultat sémantique et chaque paire de membres d'une collection
  affichent leur score cosinus brut.

---

## US-5.3 — Tests de résilience

- **EN TANT QU'** équipe
- **JE SOUHAITE** pouvoir prouver le comportement de l'application pour chaque
  panne d'Ollama
- **AFIN QUE** les pannes soient démontrables et gérées
- **Priorité :** 🔴 Bloquante
- **Responsable :** Lysandre (A/R) · Neda (R) · David (R)

### DoR

- Les six classes d'erreur de l'US-3.1 existent et sont levées aux bons
  endroits.
- **Une bonne partie du tableau est déjà couverte au niveau du transport** (voir
  la colonne « Existant »). La valeur de ce sprint est le **test de bout en
  bout** (route → service → client simulé), et les deux écarts signalés en gras.

### DoD

`backend/src/client/ollama/ollama-resilience.test.ts` — un test par scénario :

| Scénario                                              | Comportement attendu                                                         | Existant                                                                                                                   |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Ollama injoignable (`ECONNREFUSED`)                   | rejoué, puis 503 `OLLAMA_UNAVAILABLE` ; application utilisable               | transport testé                                                                                                            |
| Erreur 500                                            | rejouée `OLLAMA_MAX_RETRIES` fois, puis 502 `OLLAMA_SERVER_ERROR`            | transport testé                                                                                                            |
| Timeout                                               | **non rejoué**, 504 `OLLAMA_TIMEOUT`                                         | transport testé                                                                                                            |
| JSON malformé                                         | 502 `OLLAMA_INVALID_JSON`, sortie brute conservée pour analyse               | testé ; **vérifier que la sortie brute est journalisée** (aucune proposition n'est créée)                                  |
| Réponse vide                                          | traitée comme JSON invalide                                                  | cas à ajouter                                                                                                              |
| JSON valide mais Zod refuse                           | 502, **aucune proposition créée**                                            | client testé ; test de route à ajouter                                                                                     |
| Modèle absent (404)                                   | 503 `OLLAMA_MODEL_NOT_FOUND`, **nommant le modèle manquant**                 | classification testée ; vérifier le message                                                                                |
| Dépassement de contexte                               | 413 `OLLAMA_CONTEXT_OVERFLOW`, puis **le service réduit le lot** et réessaie | 413 testé ; **la réduction n'existe pas** : le regroupement découpe en lots fixes de 15 ROMs                               |
| `/api/embed` en forme héritée                         | vecteur lu (`embedding` au lieu d'`embeddings`)                              | testé                                                                                                                      |
| Ollama coupé **pendant** un backfill                  | lots échoués comptés, vecteurs déjà écrits conservés, reprise possible       | testé ; les jobs sont en mémoire (ADR-012), donc pas de statut `FAILED` : l'observable est `GET /api/ai/embeddings/status` |
| Ollama coupé **pendant** une détection de collections | collections des étages 1 et 2 conservées, étage sémantique ignoré            | testé au niveau de la route                                                                                                |

---

## US-5.4 — Jeu de données de démonstration

- **EN TANT QUE** présentateur
- **JE SOUHAITE** un jeu de données et un parcours reproductibles depuis un
  dépôt neuf
- **AFIN QUE** la démonstration ne dépende d'aucune manipulation manuelle
- **Priorité :** 🟠 Haute
- **Responsable :** Lysandre (A/R) · Neda (R) · David (C)

### DoR

État mesuré du dépôt (33 fichiers dans `dataset/roms/`, 7 catalogues dans
`dataset/dat/`, 6 plateformes) :

- **31 fichiers sur 33 sont identifiés par empreinte** : 25 par SHA-1 brut, 6
  par SHA-1 « données » (les 5 NES, en-tête iNES de 16 octets, et
  `Super_Mario_Kart.sfc`, en-tête copieur de 512 octets). Les 2 restants sont
  les fichiers volontairement cassés. Le critère « 14/30 → ≥ 27/30 » est donc
  **atteint**.
- Les catalogues GBA et NES _headerless_ sont importés, les cinq ROMs MegaDrive
  sont saines.

| Élément                                                             | Démontre                                 | État |
| ------------------------------------------------------------------- | ---------------------------------------- | ---- |
| ROMs GB/GBC/GBA/MegaDrive résolues par SHA-1 brut                   | identification déterministe              | ✅   |
| 5 ROMs NES et `Super_Mario_Kart.sfc`                                | identification par empreinte « données » | ✅   |
| `gb/duplicates/Tetris_(copy).gb` (identique à `Tetris.gb`, vérifié) | détection de doublon                     | ✅   |
| `nes/broken/Empty.nes`, `snes/broken/F-Zero_(truncated).sfc`        | gestion d'erreur du scan                 | ✅   |
| sous-dossiers (`duplicates/`, `broken/`)                            | parcours récursif                        | ✅   |
| **2 variantes régionales d'un même jeu**                            | regroupement sans IA (étages 1 et 2)     | ⬜   |
| **2 à 3 fichiers absents des catalogues**                           | identification IA                        | ⬜   |
| `dataset/README.md`                                                 | documentation du jeu                     | ⬜   |
| `backend/prisma/seed.ts` enrichi                                    | démo reproductible                       | ⬜   |

### DoD

- `dataset/README.md` décrit chaque fichier et ce qu'il démontre.
- `backend/prisma/seed.ts` (aujourd'hui : les six plateformes seulement) crée
  l'utilisateur `demo` et importe les catalogues présents dans `dataset/dat/`.
- Un script de démonstration en 10 étapes (`scripts/DEMO.md`), qui inclut la
  **vectorisation** et la **détection de collections**.
- Depuis un dépôt neuf : `cp .env.example .env && npm ci && npm run docker:dev`,
  puis connexion en démo, scan, identification, regroupement, recherche (sans
  aucune manipulation manuelle intermédiaire).
