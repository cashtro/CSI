// Example courses and shop products of the local demo, for the public home
// (views/accueil.ejs, PWA.md). In memory only; every name says « démo ».
function seedVitrine(db) {
  const t = db.tables;
  const ago = (days) => new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  t.cours = t.cours || [];
  t.cours.push(
    { id: 101, nom: 'L’IA au quotidien pour les PME (démo)', niveau: 'Débutant', nombre_heures: 6, prix: 149, image_url: null, created_at: ago(2) },
    { id: 102, nom: 'SEO local : être trouvé au Québec (démo)', niveau: 'Intermédiaire', nombre_heures: 8, prix: 199, image_url: null, created_at: ago(9) },
    { id: 103, nom: 'Agents IA : déléguer sans perdre le contrôle (démo)', niveau: 'Avancé', nombre_heures: 10, prix: 0, image_url: null, created_at: ago(20) },
  );
  t.Achat = t.Achat || [];
  t.Achat.push(
    { id_item: 501, title_item: 'Audit SEO express (démo)', price_item: 290, description_item: 'Un rapport clair de vos 10 priorités SEO, livré en 5 jours ouvrables.', image_item: null, created_at: ago(5) },
    { id_item: 502, title_item: 'Atelier IA d’équipe (démo)', price_item: 650, description_item: 'Trois heures avec votre équipe pour adopter l’IA dans vos tâches de tous les jours.', image_item: null, created_at: ago(12) },
    { id_item: 503, title_item: 'Pack 4 articles de blogue (démo)', price_item: 480, description_item: 'Quatre articles optimisés, écrits en français du Québec, relus par l’équipe.', image_item: null, created_at: ago(30) },
  );
}

module.exports = { seedVitrine };
