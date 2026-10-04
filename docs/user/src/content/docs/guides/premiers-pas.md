---
title: Premiers pas
description: Comment utiliser ROM RAG, étape par étape.
---

Voici comment se servir de l'application, du tout début jusqu'au premier
lancement. Pas besoin de connaissances techniques, il suffit de suivre les
étapes une par une.

## Premiers pas : installer et lancer ROM RAG

Cette partie explique, du tout début, comment faire tourner l'application dans
votre navigateur. Chaque mot technique est expliqué en même temps.

### Pré-requis nécessaires à l'installation

- **Docker Desktop** : un logiciel gratuit qui va contenir **ROM RAG** à votre
  place, comme une **boîte** qui contient déjà tout ce dont l'application a
  besoin pour démarrer. Téléchargez-le ici : https://docs.docker.com/get-docker/
  et choisissez votre système d'exploitation.
- **Git** : un petit outil qui sert uniquement à **télécharger le projet** sur
  votre machine. Téléchargez-le ici : https://git-scm.com/

Ces deux outils s'installent une seule fois, comme n'importe quel autre
logiciel. Suivez les étapes jusqu'à la fin de l'installation.

### 1. Récupérer le projet sur votre machine

<!-- TODO: Proposer une alternative sans Git -->

Choisissez un répertoire pour y télécharger le projet, puis ouvrez un
**terminal** : copier-coller exactement ce qui est écrit ci-dessous, ligne par
ligne, puis appuyez sur « Entrée » après chaque ligne

```bash
git clone https://github.com/Novachocolat/rom-rag-sae-but3.git
cd rom-rag-sae-but3
```

La première ligne récupère le projet depuis le dépôt officiel sur la plateforme
en ligne **GitHub**. La seconde dit simplement à votre machine de vous déplacer
à l'intérieur du projet pour que les prochaines instructions s'appliquent au bon
endroit.

### 2. Le fichier de réglages

```bash
cp .env.example .env
```

<!-- TODO: Proposer une alternative Windows PowerShell -->

Cette ligne crée une copie du fichier où se trouve la configuration du projet.
Pour un premier essai, vous n'avez **rien à modifier** dedans : les réglages
fournis par défaut suffisent très bien.

### 3. Lancer l'application

```bash
npm run docker:dev
```

Cette ligne démarre l'application dans son ensemble. La toute première fois,
cela peut prendre plusieurs minutes, car la machine doit télécharger tout ce
dont le projet a besoin. Les fois suivantes seront beaucoup plus rapides.

Laissez la fenêtre du terminal ouverte : l'application y tourne. Vous n'apez pas
besoin d'y retoucher.

### 4. Ouvrir l'application dans votre navigateur

Une fois que le terminal a terminé d'afficher des informations (signe que tout
est prêt), ouvrez votre navigateur internet habituel (Chrome, Firefox, Edge...)
et tapez cette adresse dans la barre URL :

`http://localhost:5173`

Vous devriez — après quelques secondes lors du premier démarrage — attérir sur
la page d'accueil de **ROM RAG**.

### Arrêter l'application nettement

Quand vous avez terminé de vous en servir, retournez dans le terminal et tapez :

```bash
npm run docker:dev:down
```

Cela éteint proprement le logiciel. **Rien n'est perdu** : la prochaine fois, il
vous suffira de refaire uniquement l'étape 3 (`npm run docker:dev`) au même
endroit, puis de rouvrir votre navigateur à l'étape 4.
