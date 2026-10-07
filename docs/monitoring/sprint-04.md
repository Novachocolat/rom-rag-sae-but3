## Sprint 4 — Embeddings, pgvector, regroupements et doublons

C'est le sprint qui justifie le « RAG » du nom du projet, et la deuxième
exigence fonctionnelle majeure : détecter que plusieurs ROMs sont le même jeu.

La stratégie est **hybride en trois étages**, et chaque étage rattrape les
limites du précédent :

1. **Déterministe et gratuit** : l'attribut `cloneofid` des catalogues No-Intro
   _est déjà_ un regroupement officiel. On l'exploite en premier : confiance
   1.0, aucun appel modèle. Pourquoi s'en priver ?
2. **Lexical** : le `baseTitle` du normaliseur (sprint 2) regroupe les variantes
   régionales à nom identique. Résout l'exemple Pokémon du dataset sans IA.
3. **Sémantique puis LLM** : pour ce qui reste ; les embeddings pgvector
   fournissent les **candidats** (voisins cosinus au-dessus d'un seuil), et le
   LLM **tranche** en JSON strict. Le vecteur propose, le LLM dispose,
   l'utilisateur valide.

Cette gradation est aussi une réponse directe au critère « choix raisonné des
composants techniques » : on n'appelle un modèle que là où rien de moins cher ne
suffit.

## US-4.1 — Vectorisation de la bibliothèque

- **EN TANT QUE** système
- **JE SOUHAITE** disposer d'un vecteur par ROM
- **AFIN QUE** la recherche de similarité soit possible
- **Priorité :** 🔴 Bloquante
- **Responsable :** Lysandre (A/R, embeddings) · David (R, pgvector)

### DoR

- **L'index HNSW existe sur une base fraîchement migrée** (reliquat US-1.1
  vérifié par test), sinon le sprint mesure des performances qui ne seront pas
  celles de la production.
- L'US-3.1 expose `EmbeddingClient` et son contrôle de dimension.
- La bibliothèque est peuplée par un scan réel (US-2.4), faute de quoi il n'y a
  rien à vectoriser.

### DoD

- Le backfill vectorise toute la bibliothèque et la progression est suivie.
- `findNearest` sur `Pokemon - Version Rouge (France)` remonte les variantes
  `Version Bleue` et `Version Jaune` en tête, avec des similarités > 0,9. **Ce
  test précis est la démonstration attendue ; l'écrire comme test automatisé**
  (les trois ROMs sont déjà dans `dataset/roms/gb/`).
- Le contrôle de dimension rejette un modèle d'embedding incompatible.
- `assertHnswIndexPresent()` échoue si l'index a disparu, et le test le prouve.
- Aucune requête brute hors de `embedding.storage.ts`.

---

## US-4.2 — Détection de collections et de doublons

- **EN TANT QU'** utilisateur
- **JE SOUHAITE** que le logiciel repère les ROMs correspondant au même jeu
- **AFIN QUE** je puisse les regrouper et repérer mes doublons
- **Priorité :** 🔴 Bloquante
- **Responsable :** Neda (A/R, heuristiques) · Lysandre (A/R, étage LLM)

### DoR

- L'US-4.1 fournit les voisins cosinus, l'US-2.3 les `baseTitle` et l'US-2.2 les
  `cloneOfId`.
- L'US-3.1 et l'US-3.2 fournissent le client LLM et le prompt de regroupement.

### DoD

- Test d'intégration : les trois ROMs Pokémon françaises du dépôt sont
  regroupées, avec la source du regroupement indiquée (et **sans appel LLM**).
- Un cluster contenant volontairement un intrus est correctement épuré par le
  LLM.
- Un `romId` inventé par le modèle est ignoré, et le test le prouve.
- Le regroupement fonctionne, en mode dégradé, Ollama éteint.

---

## US-4.3 — Interface de revue

- **EN TANT QU'** utilisateur
- **JE SOUHAITE** une file unique où consulter et arbitrer toutes les
  propositions
- **AFIN QUE** je garde la maîtrise sur ce que l'IA écrit dans ma bibliothèque
- **Priorité :** 🟠 Haute
- **Responsable :** David (A/R)

### DoR

- Les routes `/api/collections` et `/api/ai/proposals` sont figées.
- Les slices Redux `filters` (US-2.5) existent : `review` suit le même patron.

### DoD

- Traitement automatique de 10 propositions en moins d'une minute.
- Une acceptation se reflète immédiatement dans la bibliothèque (invalidation
  React Query) ; un rejet ne réapparaît pas.
