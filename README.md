# Pandora
the real pandora

# Pandora
 
Ce site web développé avec Node.js, Express et Supabase. Il est hébergé sur un serveur dédié et utilise PM2 pour la gestion des processus.
 
URL: <https://pandorabrains.com>
 
## Déploiement
 
1. Se connecter par SSH: `ssh <utilisateur>@<serveur>` (voir le gestionnaire de mots de passe de l'équipe)
 
2. Se rendre dans le dossier du projet
 
    ```bash
    cd /home/<utilisateur>/pandorabrains.com
    ```
 
3. Pull les dernières modifications
 
    ```bash
    git pull origin main
    ```
4. Clean the npm cache (optional but recommended)
# For npm:
npm cache clean --force


5. Restart le serveur web PM2
 
    ```bash
    cd /home/<utilisateur>/pandorabrains.com/innomax-html-package
    pm2 restart server.js --name "pandorabrains.com"
    ```
 
6. Vérifier que le site est en ligne en accédant à l'URL <https://pandorabrains.com>
 
7. Si le site n'est pas en ligne, vérifier les logs
 
    ```bash
    pm2 logs --name "pandorabrains.com"
    ```
 
## Notes
 
1. S'assurer que le fichier .env est correctement configuré sur le serveur avec les variables d'environnement nécessaires.
 
    ```bash
    # Ouvrir le fichier .env pour le modifier
    nano /home/<utilisateur>/pandorabrains.com/.env
    ```
 
    ```bash
    # Exemple de contenu du fichier .env
    SUPABASE_URL=''
    SUPABASE_ANON_KEY=''
    SUPABASE_SERVICE_KEY=''
    STRIPE_SECRET_KEY=
    STRIPE_PUBLIC_KEY=
    APP_URL=https://pandorabrains.com # En production laisser sur https://pandorabrains.com, https://localhost:3000 en local
    OAUTH_REDIRECT_SUCCESS=https://pandorabrains.com/ # En production laisser sur https://pandorabrains.com, https://localhost:3000 en local
    OAUTH_REDIRECT_FAILURE='https://pandorabrains.com/login' # En production laisser sur https://pandorabrains.com/login, https://localhost:3000/login en local
    NODE_ENV=production # production en ligne : masque les traces d'erreur ; development en local
    EMAIL_USER=
    EMAIL_PASSWORD=
    OWNER_EMAIL=
    FACEBOOK_PIXEL_ID=''
    PORT=3004 # Laisser sur 3004 pour serveur PM2, 3000 en local
    SENDGRID_API_KEY=''
    SENDGRID_EMAIL=''
    STRIPE_WEBHOOK_SECRET='' # secret du endpoint /webhook dans le tableau de bord Stripe
    TOTP_ENC_KEY='' # clé aléatoire longue (ex. openssl rand -hex 32) : chiffre les secrets 2FA ; ne jamais la changer sans procédure
    TWOFA_SETUP_KEY='' # optionnel, clé aléatoire pour signer les jetons de configuration 2FA (sinon dérivée de TOTP_ENC_KEY)
    COOKIE_SECURE= # laisser vide en ligne ; false seulement en local sur http
    ALLOW_DEGRADED_BOOT= # laisser vide en ligne ; true seulement en local/CI pour démarrer sans clés
    LOG_LEVEL=info # error | warn | info | debug
    ```
 
2. S'assurer que les dépendances sont installées
 
    ```bash
    cd /home/<utilisateur>/pandorabrains.com/innomax-html-package
    npm i
    ```
3. S'assurer que le serveur est configuré pour utiliser le port 3004
 
4. git reset --hard
 
ensuite
 
git checkout <branch>
git pull origin <branch>