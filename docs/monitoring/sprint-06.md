## Sprint 6 — Durcissement, couverture, livraison

Aucune fonctionnalité nouvelle. S'il reste du retard des sprints précédents,
**c'est ici qu'il se rattrape**. Le calendrier serré a été volontairement placé
un mois avant la deadline officielle de mi-novembre.

---

## US-6.1 — Couverture et qualité

- **EN TANT QUE** développeur
- **JE SOUHAITE** avoir un code maintenable, testable et de qualité
- **AFIN QUE** je puisse valider l'échéance du projet
- **Priorité :** 🔴 Bloquante
- **Responsable :** David (A/R) · Lysandre (R)

### DoR

- Tous les sprints fonctionnels sont clos ; la couverture courante est mesurée
  (backend : fait).

### DoD

- `npm run test:coverage` échoue sous le seuil ; la CI l'exécute ; aucun
  marqueur `TODO`/`FIX` orphelin ne subsiste.

---

## US-6.2 — Sécurité et intégrité

- **EN TANT QUE** développeur
- **JE SOUHAITE** assurer la sécurité des utilisateurs
- **AFIN QUE** l'intégrité de leurs données soit admise
- **Priorité :** 🟠 Haute
- **Responsable :** Lysandre (A/R) · Neda (R)

### DoR

- Toutes les routes existent.

### DoD

- Chaque route authentifiée est passée en revue et porte un test prouvant qu'un
  utilisateur ne peut pas lire la ROM (ou la collection) d'un autre.

---

## US-6.3 — Docker de production

- **EN TANT QUE** développeur
- **JE SOUHAITE** déployer l'application dans un environnement propre
- **AFIN QUE** la mise en production éventuelle de l'application soit possible
- **Priorité :** 🟠 Haute
- **Responsable :** Lysandre (A/R) · David (R)

### DoR

- L'application est fonctionnelle en développement et la liste des variables de
  production est figée.

### DoD

- `npm run docker:prod` démarre une pile complète et le parcours de
  démonstration y fonctionne de bout en bout.

---

## US-6.4 — Documentation finale

- **EN TANT QU'** utilisateur
- **JE SOUHAITE** pouvoir accéder à une documentation mise à jour et fiable
- **AFIN QUE** je puisse manipuler l'application sans difficulté ou contribuer
  au projet efficacement
- **Priorité :** 🔴 Bloquante
- **Responsable :** Neda (A/R) · David (R)

### DoR

- Le code est gelé sur les points documentés.

### DoD

- Aucun écart connu entre une ADR et le code ; vocabulaire homogène.
