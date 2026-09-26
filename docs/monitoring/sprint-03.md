# Sprint n°3 - Brique IA : client Ollama, prompts, identification assistée

Ce sprint produit le **cœur IA du sujet**. Dialogue client-serveur avec un
gestionnaire d'inférence, ingénierie de prompt à sortie structurée, contrôle et
validation des sorties, et choix raisonné des composants.

L'ordre de travail est délibéré et doit être respecté :

1. **D'abord le transport** (`ollama-http.ts`) : timeouts, retries, taxonomie
   d'erreurs. Sans ça, chaque bug d'inférence sera indébuggable.
2. **Ensuite le contrat de sortie** : on utilise le champ **`format`** de l'API
   Ollama, qui accepte un **JSON Schema** et contraint le décodage du modèle.
   Zod 4 fournit `z.toJSONSchema()` : le **même schéma Zod** sert à contraindre
   le modèle _et_ à valider sa réponse.
3. **Puis les prompts**, dans des fichiers versionnés de `prompts/`, chargés au
   démarrage. Jamais de chaîne de prompt dans du `.ts`.
4. **Enfin la politique de confiance** : ce qui sépare une identification d'une
   proposition.

Une exigence traverse tout le sprint : **l'application doit rester utilisable
quand Ollama est éteint.** Toutes les fonctionnalités des sprints 1 et 2 doivent
continuer de marcher, et l'IU doit dire clairement pourquoi la fonction IA est
grisée.

## US3.1 — Adaptateur Ollama

- **EN TANT QUE** développeur
- **JE SOUHAITE** une interface d'inférence unique, typée et résiliente
- **AFIN QUE** changer de modèle ou de fournisseur ne demande qu'un changement
  de variable d'environnement
- **Priorité :** 🔴 Bloquante
- **Responsable :** Lysandre (A/R) · David (C) · Neda (I)

### DoR

- Le champ `format` avec JSON Schema n'est pas présent du wrapper initial. Rien
  ne garantit qu'il soit disponible, essayer
  `curl $OLLAMA_BASE_URL/api/version`.
- `curl $OLLAMA_BASE_URL/api/tags` liste bien `gemma4:26b` et `embeddinggemma`.

### DoD

- Tests par `vi.mock` de `fetch` couvrant chacun des six modes de panne.
- Test vérifiant qu'un timeout n'est **pas** rejoué et qu'un 500 l'est.
- Le corps de requête effectivement envoyé est asserté (modèle, température,
  `num_ctx`, `format`), prouvant l'externalisation de la config.
- L'indicateur Ollama de `AppLayout` est alimenté par `pingOllama()` et non plus
  par une constante.

---

## US3.2 — Prompts versionnés

- **EN TANT QUE** développeur
- **JE SOUHAITE** que les prompts vivent dans des fichiers relus et versionnés
- **AFIN QUE** modifier un prompt passe par une PR et soit traçable
- **Priorité :** 🟠 Haute
- **Responsable :** Lysandre (A/R) · David (C, revue)

### DoR

- L'US-3.1 expose `generateJson` : sans elle, aucun prompt n'est exécutable.

### DoD

- Aucune chaîne de prompt dans un `.ts` ; le chargeur est testé, y compris le
  cas de la variable manquante.

---

## US3.3 — Identification assistée par IA

- **EN TANT QU'** utilisateur
- **JE SOUHAITE** qu'une ROM non identifiée par les catalogues reçoive une
  proposition de l'IA, clairement étiquetée comme telle
- **AFIN QUE** je puisse la valider ou la rejeter en connaissance de cause
- **Priorité :** 🔴 Bloquante
- **Responsable :** Lysandre (A/R) · Neda (R, routes et persistance)

### DoR

- Les US-3.1 et 3.2 sont livrées (client et prompts).
- L'US-2.3 est livrée : sans cascade déterministe, on ne sait pas quelles ROMs
  sont légitimement `UNIDENTIFIED`, et l'IA serait appelée sur tout.
- Le jeu de test contient 2 à 3 fichiers volontairement hors catalogue, sans
  quoi cette US n'a rien à démontrer.

### DoD

- Une ROM absente des catalogues reçoit une proposition étiquetée `AI_PROPOSED`,
  avec sa confiance et son `reasoning` visibles.
- Une proposition incohérente (plateforme incompatible avec l'extension) est
  **rejetée automatiquement** et le test le prouve.
- Deux appels identiques consécutifs : le second est servi par le cache
  (`fromCache: true`) et ne déclenche aucun `fetch`.
- Avec Ollama éteint, la route renvoie **503 `OLLAMA_UNAVAILABLE`** et le reste
  de l'application fonctionne normalement.

---

## US3.4 — Interface : fiabilité et dégradation

- **EN TANT QU'** utilisateur
- **JE SOUHAITE** voir d'un coup d'œil ce qui est certain et ce qui est proposé
- **AFIN QUE** je ne prenne jamais une hypothèse de l'IA pour un fait
- **Priorité :** 🟠 Haute
- **Responsable :** David (A/R) · Lysandre (C)

### DoR

- L'US-3.3 expose ses quatre routes, et l'US-3.1 la sonde de disponibilité.
- Les composants shadcn `badge`, `tooltip`, `card`, `dialog` sont générés.

### DoD

- Démonstration réalisable : couper Ollama, rafraîchir, constater que
  l'application reste pleinement utilisable et que les actions IA sont
  explicitement grisées ; rallumer, la pastille repasse au vert sans
  rechargement.
- Une ROM résolue par empreinte « données » affiche la mention correspondante,
  distincte d'une correspondance exacte.
