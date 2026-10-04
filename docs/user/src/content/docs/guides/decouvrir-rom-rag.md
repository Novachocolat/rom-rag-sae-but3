---
title: Découvrir ROM RAG
description: C'est quoi, ROM RAG ?
---

## C'est quoi, ROM RAG ?

**ROM RAG** (pour Retrieval-Augmented Generation) est une application web qui
aide à **ranger et organiser vos collections de ROMs**, stockés sur votre
ordinateur.

Vous avez des dossiers remplis de centaines de jeux vidéo rétro, avec des noms
parfois bizarres, mal orthographiés ou qui se ressemblent ? Cette application va
vous aider à :

- savoir **de quel jeu il s'agit vraiment**,
- savoir **à quelle console il appartient**,
- repérer quand **plusieurs fichiers correspondent en fait au même jeu** (par
  exemple, une version française et une version américaine d'un même Pokémon),
- et tout ça **sans que vous ayez à tout vérifier vous-même, à la main.**

## À quoi ça sert concrètement ?

Imaginez que vous ayez un dossier avec les fichiers suivants :

- `Pokemon - Red Version (France).gb`
- `Pokemon_Red_USA.gb`
- `pkmn_red_germany.gb`

À l'œil nu, ce n'est pas toujours évident de voir que ce sont trois versions du
**même jeu**, juste dans des langues différentes. **ROM RAG** va :

1. **Regarder dans ton dossier** (et dans tous les sous-dossiers choisis) pour
   trouver tous les jeux présents.
2. **Chercher des informations fiables** sur chaque jeu, en comparant chaque
   fichier à un catalogue qui connaît tous les jeux existants.
3. Quand le jeu n'est pas reconnu directement, **une intelligence artificielle
   prend le relais** pour essayer de deviner de quel jeu il s'agit, à partir
   d'indices comme le nom du fichier.
4. Le logiciel **regroupe ensuite les jeux qui se ressemblent**, comme les
   différentes versions linguistiques d'un même jeu, et vous propose des
   regroupements.
5. Vous, en tant qu'utilisateur, vous pouvez **consulter les propositions et
   dire si vous êtes d'accord ou non**. Rien n'est fait automatiquement dans
   votre dos.

## Pourquoi utiliser une intelligence artificielle ?

Certains fichiers ont des noms trop mal écrits, incomplets ou inconnus pour être
identifiés directement grâce aux listes de référence. Dans ce cas, une IA est
utilisée pour **essayer de deviner** de quel jeu il s'agit.

L'application fait toujours bien la différence entre :

- une **identification certaine** (le jeu est reconnu avec certitude grâce à une
  base de données fiable),
- et une **simple proposition de l'IA** (une hypothèse, qui peut être fausse et
  que vous pouvez valider ou refuser).

**Cela évite de confondre une information sûre avec une simple supposition.**

## De quoi est capable ROM RAG ?

- **Choisir un dossier** sur votre ordinateur contenant vos jeux.
- Laisser l'application **analyser automatiquement** tout le dossier, y compris
  les sous-dossiers.
- **Consulter la liste de jeux trouvés**, avec leurs informations (nom du jeu,
  console, langue, etc.).
- **Rechercher un jeu** dans vos collections facilement.
- Voir les **regroupements proposés** (par exemple : « ces 3 fichiers sont en
  fait le même jeu ») et les **valider ou les refuser**.
- Être informé si un jeu n'a pas pu être identifié, ou si l'IA n'est pas
  disponible à un moment donné.

## En cas de problème, que se passe-t-il ?

L'application est conçue pour rester utile même en cas de problème :

- Si un jeu ne peut **pas être identifié du tout**, il est simplement affiché
  comme « non identifié », sans bloquer le reste.
- Si les informations trouvées sont **contradictoires ou incertaines**,
  l'application vous le signale au lieu de choisir à votre place.
- Si le service d'intelligence artificielle est **temporairement indisponible**,
  l'application continue de fonctionner avec les informations déjà connues, et
  réessaiera plus tard.

## En résumé

**ROM RAG**, c'est un **assistant qui trie votre bibliothèque de ROMs à votre
place**, en identifiant chaque jeu, en repérant les doublons ou versions
similaires, et en vous laissant toujours le dernier mot avant de valider quoi
que ce soit !
