// js/i18n.js
//
// Lightweight English/French translation layer. Monochrome has no i18n
// infrastructure, so instead of touching hundreds of code sites this walks the
// DOM and translates known strings (text nodes + placeholder/title attributes),
// with a MutationObserver covering dynamically rendered UI. Switching language
// reloads the app so English is always the clean baseline.

const LANG_KEY = 'app-language';

// English -> French. Keys are matched against trimmed text content.
const FR = {
    // Sidebar
    Home: 'Accueil',
    Library: 'Bibliothèque',
    Recent: 'Récents',
    Download: 'Télécharger',
    Settings: 'Paramètres',
    Pinned: 'Épinglés',

    // Header
    'Search for tracks, artists, albums...': 'Rechercher des titres, artistes, albums...',
    Account: 'Compte',
    'Go Back': 'Retour',
    'Go Forward': 'Avancer',

    // Home page
    'Recently Downloaded': 'Téléchargés récemment',
    'Recommended Songs': 'Titres recommandés',
    'Recommended Albums': 'Albums recommandés',
    'Recommended Artists': 'Artistes recommandés',
    'Jump Back In': 'Reprendre l’écoute',
    'Start Infinite Radio': 'Lancer la radio infinie',
    'Welcome to Monochrome': 'Bienvenue sur Monochrome',
    "You haven't listened to anything yet. Search for your favorite songs to get started!":
        'Vous n’avez encore rien écouté. Recherchez vos chansons préférées pour commencer !',
    'Clear History': 'Effacer l’historique',
    Refresh: 'Actualiser',

    // Search page
    'Search Results for': 'Résultats pour',
    Tracks: 'Titres',
    Artists: 'Artistes',
    Albums: 'Albums',
    Playlists: 'Playlists',
    Podcasts: 'Podcasts',
    Videos: 'Vidéos',
    'No tracks found.': 'Aucun titre trouvé.',
    'No artists found.': 'Aucun artiste trouvé.',
    'No albums found.': 'Aucun album trouvé.',
    'No playlists found.': 'Aucune playlist trouvée.',

    // Library
    'My Playlists': 'Mes playlists',
    'Create playlist': 'Créer une playlist',
    'Create folder': 'Créer un dossier',
    Favorites: 'Favoris',
    'Liked Tracks': 'Titres aimés',
    Liked: 'Aimés',
    'Liked Artists': 'Artistes aimés',
    Downloaded: 'Téléchargés',
    Singles: 'Singles',
    'Unknown Artist': 'Artiste inconnu',
    'Unknown artist': 'Artiste inconnu',
    'Assign artist': 'Attribuer un artiste',
    'No albums downloaded yet.': 'Aucun album téléchargé pour l’instant.',
    'No artists yet.': 'Aucun artiste pour l’instant.',
    'No singles downloaded yet.': 'Aucun single téléchargé pour l’instant.',
    'No liked tracks yet.': 'Aucun titre aimé pour l’instant.',
    'Search liked tracks...': 'Rechercher dans les titres aimés...',
    'Family server not connected.': 'Serveur familial non connecté.',
    'Could not load downloaded music.': 'Impossible de charger la musique téléchargée.',
    'List view': 'Vue liste',
    'Card view': 'Vue cartes',
    'Shuffle Liked Tracks': 'Lecture aléatoire des titres aimés',
    'Download Liked Tracks': 'Télécharger les titres aimés',

    // Download page
    'Download from YouTube': 'Télécharger depuis YouTube',
    'Search YouTube and download tracks as FLAC straight into the family music library.':
        'Recherchez sur YouTube et téléchargez des titres en FLAC directement dans la bibliothèque musicale familiale.',
    'Search YouTube...': 'Rechercher sur YouTube...',
    'Search albums on YouTube...': 'Rechercher des albums sur YouTube...',
    Songs: 'Titres',
    Listen: 'Écouter',
    'Download Album': 'Télécharger l’album',
    'Queued ✓': 'En file ✓',
    'Queuing...': 'Mise en file...',
    'Download queue': 'File de téléchargement',
    Clear: 'Effacer',
    'Clear finished downloads': 'Effacer les téléchargements terminés',
    'Download queue cleared.': 'File de téléchargement effacée.',
    'Searching YouTube...': 'Recherche sur YouTube...',
    'No results found.': 'Aucun résultat trouvé.',
    'Loading album tracks...': 'Chargement des titres de l’album...',
    Done: 'Terminé',
    Stop: 'Arrêter',

    // Family page
    "Who's listening?": 'Qui écoute ?',
    'Each profile has its own playlists, favorites and listening history.':
        'Chaque profil a ses propres playlists, favoris et historique d’écoute.',
    'New profile': 'Nouveau profil',
    'Create a new profile': 'Créer un nouveau profil',
    'Current profile': 'Profil actuel',
    'Loading profiles...': 'Chargement des profils...',
    'Choose a profile': 'Choisir un profil',

    // Playlist page
    Play: 'Lecture',
    Shuffle: 'Aléatoire',
    Save: 'Enregistrer',
    'Add tracks': 'Ajouter des titres',
    'Add tracks to this playlist': 'Ajouter des titres à cette playlist',
    'Search tracks...': 'Rechercher des titres...',
    'Search your library to add tracks...': 'Recherchez dans votre bibliothèque pour ajouter des titres...',
    'Searching your library...': 'Recherche dans votre bibliothèque...',
    'No tracks found in the library.': 'Aucun titre trouvé dans la bibliothèque.',
    '+ Add': '+ Ajouter',
    'Suggested Songs From Your Playlist': 'Suggestions issues de votre playlist',
    'Refresh Recommendations': 'Actualiser les recommandations',
    'Remove from playlist': 'Retirer de la playlist',
    tracks: 'titres',

    // Album / artist pages
    'Popular Tracks': 'Titres populaires',
    'No albums found. ': 'Aucun album trouvé.',
    Popularity: 'Popularité',

    // Modals & common actions
    Cancel: 'Annuler',
    Create: 'Créer',
    Delete: 'Supprimer',
    Remove: 'Retirer',
    Edit: 'Modifier',
    Close: 'Fermer',
    'Add to playlist': 'Ajouter à une playlist',
    '+ Create New Playlist': '+ Créer une nouvelle playlist',
    'Add to queue': 'Ajouter à la file',
    'Play next': 'Lire ensuite',
    'Go to artist': 'Voir l’artiste',
    'Go to album': 'Voir l’album',
    'Copy link': 'Copier le lien',
    Share: 'Partager',
    'Track info': 'Infos du titre',
    'Playlist Name': 'Nom de la playlist',
    Description: 'Description',
    'Upload Cover': 'Importer une pochette',
    'or URL': 'ou URL',

    // Player bar
    'Select a song': 'Sélectionnez un titre',
    Previous: 'Précédent',
    Next: 'Suivant',
    Pause: 'Pause',
    Queue: 'File d’attente',
    Lyrics: 'Paroles',
    Volume: 'Volume',
    Mute: 'Muet',
    'Toggle shuffle': 'Lecture aléatoire',
    'Toggle repeat': 'Répétition',
    'Fullscreen Mode': 'Mode plein écran',

    // Settings
    Appearance: 'Apparence',
    Interface: 'Interface',
    Scrobbling: 'Scrobbling',
    Audio: 'Audio',
    System: 'Système',
    Language: 'Langue',
    'Choose the app language': 'Choisir la langue de l’application',
    Theme: 'Thème',
    'Custom Theme': 'Thème personnalisé',
    'Show Recommended Songs': 'Afficher les titres recommandés',
    'Show Recommended Albums': 'Afficher les albums recommandés',
    'Show Recommended Artists': 'Afficher les artistes recommandés',
    'Show Jump Back In': 'Afficher « Reprendre l’écoute »',
    'Compact Artists': 'Artistes compacts',
    'Compact Albums': 'Albums compacts',
    'Artist Banners': 'Bannières d’artistes',
    'Keyboard Shortcuts': 'Raccourcis clavier',
    Cache: 'Cache',
    'Auto-Update App': 'Mise à jour automatique',
    Analytics: 'Statistiques',
    'Reset Local Data': 'Réinitialiser les données locales',
    'Backup & Restore': 'Sauvegarde et restauration',
    'Export All Settings': 'Exporter tous les paramètres',
    'Blocked Content': 'Contenu bloqué',
    'Search settings...': 'Rechercher un paramètre...',

    // Family Server settings tab
    'Family Server': 'Serveur familial',
    'Connection Status': 'État de la connexion',
    'Checking connection...': 'Vérification de la connexion...',
    Connected: 'Connecté',
    'Server unreachable': 'Serveur injoignable',
    'Check now': 'Vérifier',
    'Server URL': 'URL du serveur',
    'Jellyfin server address. Leave as /jellyfin to use the built-in proxy.':
        'Adresse du serveur Jellyfin. Laissez /jellyfin pour utiliser le proxy intégré.',
    'Leave empty to use the family server login.': 'Laissez vide pour utiliser la connexion du serveur familial.',
    'Signed in as': 'Connecté en tant que',
    Connect: 'Se connecter',
    'Sign out': 'Se déconnecter',
    Username: 'Nom d’utilisateur',
    Password: 'Mot de passe',
    'Server URL saved.': 'URL du serveur enregistrée.',
    'Enter a username first.': 'Saisissez d’abord un nom d’utilisateur.',
    'Connected to the family server.': 'Connecté au serveur familial.',
    'Could not connect:': 'Connexion impossible :',
    'Signed out.': 'Déconnecté.',
    'Family server unreachable': 'Serveur familial injoignable',

    // Dynamic strings (template literals that bypass the MutationObserver)
    'Switched to': 'Profil changé :',
    'Profile created.': 'Profil créé.',
    'Could not create profile:': 'Impossible de créer le profil :',
    'Could not load profiles from the family server:':
        'Impossible de charger les profils depuis le serveur familial :',
    'Name for the new profile:': 'Nom du nouveau profil :',
    'Switch to': 'Passer à',
    'Install app': 'Installer l’application',
    'Install Monochrome on this device for a fullscreen, app-like experience.':
        'Installez Monochrome sur cet appareil pour une expérience plein écran, comme une application.',
    Install: 'Installer',
    'Not now': 'Plus tard',
    'Custom avatar': 'Avatar personnalisé',
    'Remove avatar': 'Supprimer l’avatar',
    'Avatar updated.': 'Avatar mis à jour.',
    'Could not read the image.': 'Impossible de lire l’image.',
    'Refreshing...': 'Actualisation...',

    // Download page dynamic strings
    'Queued:': 'En file :',
    Queued: 'En file',
    'Download failed:': 'Échec du téléchargement :',
    'Previewing:': 'Aperçu :',
    'Could not clear queue:': 'Impossible de vider la file :',
    'Error:': 'Erreur :',
    Downloading: 'Téléchargement',
};

// Translate a single string from JS code (template literals never hit the
// MutationObserver, so dynamic UI must call this explicitly).
export function t(text) {
    if (getLanguage() !== 'fr') return text;
    return FR[text] || text;
}

export function getLanguage() {
    try {
        return localStorage.getItem(LANG_KEY) || 'en';
    } catch {
        return 'en';
    }
}

export function setLanguage(lang) {
    try {
        localStorage.setItem(LANG_KEY, lang);
    } catch {
        // ignore
    }
}

function translateTextNode(node) {
    const original = node.nodeValue;
    const trimmed = original.trim();
    if (!trimmed) return;
    const replacement = FR[trimmed];
    if (replacement) {
        node.nodeValue = original.replace(trimmed, replacement);
    }
}

const ATTRS = ['placeholder', 'title', 'aria-label'];

function translateElementAttrs(el) {
    for (const attr of ATTRS) {
        const value = el.getAttribute?.(attr);
        if (value && FR[value.trim()]) {
            el.setAttribute(attr, FR[value.trim()]);
        }
    }
}

export function translateTree(root) {
    if (root.nodeType === Node.TEXT_NODE) {
        translateTextNode(root);
        return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;

    if (root.nodeType === Node.ELEMENT_NODE) translateElementAttrs(root);

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
        if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
        else translateElementAttrs(node);
        node = walker.nextNode();
    }
}

let observer = null;

const RTL_LANGS = ['ar', 'he', 'fa', 'ur'];

export function initI18n() {
    const lang = getLanguage();
    document.documentElement.lang = lang;
    // Mirror the layout for right-to-left languages (see RTL FOUNDATION in styles.css)
    document.documentElement.dir = RTL_LANGS.includes(lang) ? 'rtl' : 'ltr';
    if (lang !== 'fr') return;

    translateTree(document.body);

    observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const added of mutation.addedNodes) {
                translateTree(added);
            }
            if (mutation.type === 'characterData' && mutation.target) {
                translateTextNode(mutation.target);
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

// Settings UI wiring (the select lives in the Appearance tab)
export function bindLanguageSelect() {
    const select = document.getElementById('app-language-select');
    if (!select) return;
    select.value = getLanguage();
    select.addEventListener('change', () => {
        setLanguage(select.value);
        // Reload so the whole app re-renders in the chosen language
        window.location.reload();
    });
}
