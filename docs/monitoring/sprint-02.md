# Sprint n°2 - Scan récursif, hashing, parsing DAT, identification déterministe

Ce sprint produit le **cœur non-IA du sujet**, et il ne faut surtout pas le
bâcler : plus l'identification déterministe est bonne, moins l'IA a de travail,
et plus le projet est crédible. L'IA **n'intervient que si les bases de
référence échouent**.

Trois briques indépendantes, développables en parallèle :

- **Le scanner** parcourt récursivement un répertoire, filtre par extension et
  calcule **MD5 + SHA-1 en flux**. La contrainte est le nombre de fichiers, d'où
  la concurrence bornée par `SCAN_CONCURRENCY` et le générateur asynchrone.
- **Le parseur DAT** transforme un XML Logiqx en lignes de base. Les cinq
  catalogues du dépôt sont au même schéma (un `<rom>` par `<game>`, avec
  `sha256`), **à deux exceptions près** qui suffisent à interdire toute
  simplification : `Bases Loaded (USA)` (NES) et `Sonic & Knuckles (World)`
  (MegaDrive) portent deux `<rom>`.
- **L'identification** croise les deux, par ordre de fiabilité décroissante.

Le tout est orchestré par un job asynchrone : le scan renvoie `202 Accepted`
avec un identifiant, écrit sa progression dans Redis, et le frontend interroge
cet état. Aucune requête HTTP ne doit rester ouverte pendant un scan.

## US2.1 — Parcours récursif et empreintes

- **EN TANT QU'** utilisateur
- **JE SOUHAITE** indiquer un répertoire et que l'application y trouve toutes
  mes ROMs avec leurs empreintes MD5 et SHA-1
- **AFIN QUE** je puisse les identifier ensuite
- **Priorité :** 🔴 Bloquante
- **Responsable :** Neda (A/R) · Lysandre (R) · David (I)

### DoR

- Les nouvelles colonnes `md5Data`, `sha1Data`, `headerBytesSkipped` existent en
  base.
- `ROM_EXTENSIONS` couvre les six plateformes.
- `seed.ts` peuple la table `Plateform`.
- Les modèles Prisma sont établis et l'extension `pgvector` intégrée dans un
  migration manuelle.

### DoD

- Tests unitaires empêchant les chemins hostiles d'être acceptés.
- Tests des fonctions de hashing sur un fichier incompatible ou corrompu.
- Test du parcours récursif sur une arborescence temporaire à 3 niveaux.
- Test de non-régression assertant que les fichiers de `dataset/roms/` sont tous
  reconnus comme ROMs et correctement attribués à leur plateforme.

---

## US2.2 — Import et indexation des catalogues No-Intro

- **EN TANT QU'** utilisateur
- **JE SOUHAITE** fournir les fichiers `.dat` des consoles que je possède
- **AFIN QUE** mes ROMs soient identifiées à partir d'une source de référence
- **Priorité :** 🔴 Bloquante
- **Responsable :** Lysandre (A/R) · Neda (R) · David (C)

### DoR

- Les six catalogues sont présents dans `dataset/dat/` et leurs compteurs de
  références sont relevés et consignés.

### DoD

- Les six catalogues `.dat` du dépôt s'importent sans erreur ; les compteurs
  attendus sont vérifiés en test.
- Un test de non-régression sur un extrait XML du catalogue pour les différentes
  variantes par plateforme.
- Réimporter le même fichier ne duplique rien.
- Un `.dat` tronqué produit une `AppError` 400, pas un plantage.

---

## US2.3 — Identification déterministe

- **EN TANT QU'** utilisateur
- **JE SOUHAITE** que mes ROMs soient identifiées automatiquement quand leur
  empreinte figure dans un catalogue `.dat`.
- **AFIN QUE** l'IA ne soit sollicitée que sur les cas réellement inconnus
- **Priorité :** 🔴 Bloquante
- **Responsable :** Neda (A/R) · Lysandre (R) · David (I)

### DoD

- Une table de tests d'au moins **10 cas** de normalisation, dont les versions
  des jeux Pokémon pour la **Game Boy**, **Game Boy Color** et **Game Boy
  Advance**.

---

## US2.4 — Job de scan asynchrone

- **EN TANT QU'** utilisateur
- **JE SOUHAITE** lancer un scan et suivre sa progression en temps réel
- **AFIN QUE** l'interface ne gèle pas sur une bibliothèque de plusieurs
  milliers de fichiers
- **Priorité :** 🔴 Bloquante
- **Responsable :** David (A/R, Redis & job) · Neda (R, routes) · Lysandre (C)

### DoR

- US2.1, US2.2 et US2.3 terminées.

### DoD

- Un scan de `dataset/roms/` se termine et remplit la table `Rom`.
- Relancer le scan est **idempotent** : aucun doublon, seul `lastScannedAt`
  bouge.
- Un fichier illisible (permissions) incrémente `errorCount` **sans interrompre
  le scan**.
- L'annulation fonctionne et laisse le job en `CANCELLED`.

---

## US2.5 — Interface de bibliothèque et de scan

- **EN TANT QU'** utilisateur
- **JE SOUHAITE** parcourir ma bibliothèque et lancer un scan depuis l'interface
- **AFIN QUE** je n'ai jamais à utiliser `curl`
- **Priorité :** 🟠 Haute
- **Responsable :** David (A/R)

### DoR

- `components.json` est aligné sur l'arborescence réelle et les composants
  shadcn nécessaires sont générés.
- Les routes `/api/scans` et `/api/library` sont figées côté backend.

### DoD

- Le parcours complet fonctionne dans le navigateur : connexion -> choix du
  dossier -> scan -> barre de progression -> tableau rempli.
- La distinction visuelle « identifié de façon fiable » / « non identifié » est
  immédiate, sans lire de texte.
