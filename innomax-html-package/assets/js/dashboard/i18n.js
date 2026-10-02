// Dashboard i18n + language switching. Extracted verbatim from
// dashboard-client.ejs (was ~985 inline lines) so the client dashboard is
// no longer a monolith. Loaded as a classic script at the same position, so
// top-level bindings (translations, changeLanguage) and timing are unchanged.

    // Dictionnaire de traductions simplifié (seulement anglais-français)
const translations = {
    en: {
        // Sections menu
        dashboard: "Dashboard",
        statistics: "Statistics",
        programs: "Programs",
        education: "Education",
        courses: "Courses",
        portfolio: "Portfolio",
        lottery: "Lottery",
        draws: "Raffle",
        welcome: "Welcome",
        teacher: "Teacher",
        appointment: "Appointment",
        availability: "Availability",
        mainMenu: "main menu",
        meet: "Meet",
        
        // Dashboard
        fundsCollected: "Funds Collected",
        growthRate: "Growth Rate",
        activeScholarships: "Active Scholarships",
        beneficiaryStudents: "Beneficiary Students",
        ticketSales: "Ticket Sales",
        monthlyReports: "Monthly Reports",
        
        // Statistics
        dataAnalysis: "Data Analysis",
        monthlyPerformance: "Monthly Performance Visualization and Key Performance Indicators",
        advancedAnalysis: "Advanced Data Analysis and Segmentation",
        trends: "Trends",
        trendsDescription: "Analysis of Emerging Trends and Strategic Directions",
        userSegmentation: "User Segmentation",
        behavioralAnalysis: "Behavioral Analysis",
        purchasePredictions: "Purchase Predictions",
        segments: "segments",
        models: "models",
        accuracy: "accuracy",
        lastUpdate: "Last Update",
        userGrowth: "User Growth",
        mobileEngagement: "Mobile Engagement",
        retention: "Retention",
        previousQuarter: "Compared to the previous quarter",
        mobileUsage: "Increase in Mobile Usage",
        retentionRate: "30-Day Retention Rate",
        
        // Education
        manageAvailability: "Manage your availability slots",
        courseTraining: "Course and Training Management",
        
        // Lottery
        lotteryManagement: "Lottery Draw Management and Associated Prizes",
        
        // Common
        loadingCourses: "Loading courses...",
        loadingMonthlyReports: "Loading monthly reports...",
        loadingDataAnalysis: "Loading data analysis reports...",
        loadingTrends: "Loading trends data...",
        loadingMeetings: "Loading meeting rooms...",
        noDataAvailable: "No data available",
        noCourses: "You are not enrolled in any courses yet.",
        noMeetings: "No meetings available",
        errorLoading: "An error occurred while loading the data",
        viewDetails: "View details",
        edit: "Edit",
        modify: "Modify",
        cancel: "Cancel",
        update: "Update",
        create: "Create",
        add: "Add",
        delete: "Delete",
        price: "Price",
        duration: "Duration",
        date: "Date",
        time: "Time",
        searchPlaceholder: "Search...",
        finalized: "Finalized on",
        currentlyBeingFinalized: "Currently being finalized",
        january: "January",
        february: "February",
        march: "March",
        minutes: "minutes",
        hours: "hours",
        students: "students",
        noDescription: "No description available",
        
        // Meeting status
        active: "Ongoing",
        scheduled: "Scheduled",
        past: "Completed",
        
        // Course modal
        addCourse: "Add a new course",
        editCourse: "Edit course",
        courseDetails: "Course details",
        courseTitle: "Course title",
        level: "Level",
        hours: "Number of hours",
        totalDuration: "Total course duration in hours",
        courseFiles: "Course files",
        acceptedFormats: "Accepted formats: PDF, MP4, ZIP (max 50MB)",
        
        // Course levels
        beginner: "Beginner",
        intermediate: "Intermediate",
        advanced: "Advanced",
        
        // Availability
        createAvailability: "Create availability",
        startDateTime: "Start date and time",
        endDateTime: "End date and time",
        commissionRate: "Commission rate (%)",
        
        // Meeting
        join: "Join",
        viewRecording: "View recording",
        createMeeting: "Create a new meeting",
        
        // Appointment
        createAppointment: "Create an appointment",
        
        // Video conferencing
        videoConferencing: "Video conferencing and virtual meetings"
    },
    fr: {
        // Sections menu
        dashboard: "Tableau de bord",
        statistics: "Statistiques",
        programs: "Programmes",
        education: "Éducation",
        courses: "Cours",
        portfolio: "Portfolio",
        lottery: "Loterie",
        draws: "Tirages",
        welcome: "Bienvenue",
        teacher: "Enseignant",
        appointment: "Rendez-vous",
        availability: "Disponibilités",
        mainMenu: "menu principal",
        meet: "Réunion",
        
        // Dashboard
        fundsCollected: "Fonds Collectés",
        growthRate: "Taux de Croissance",
        activeScholarships: "Bourses Actives",
        beneficiaryStudents: "Étudiants Bénéficiaires",
        ticketSales: "Ventes de Tickets",
        monthlyReports: "Rapports Mensuels",
        
        // Statistics
        dataAnalysis: "Analyse de Données",
        monthlyPerformance: "Visualisation des performances mensuelles et indicateurs clés de performance",
        advancedAnalysis: "Analyse de données avancée et segmentation",
        trends: "Tendances",
        trendsDescription: "Analyse des tendances émergentes et orientations stratégiques",
        userSegmentation: "Segmentation des Utilisateurs",
        behavioralAnalysis: "Analyse Comportementale",
        purchasePredictions: "Prédictions d'Achat",
        segments: "segments",
        models: "modèles",
        accuracy: "précision",
        lastUpdate: "Dernière mise à jour",
        userGrowth: "Croissance Utilisateurs",
        mobileEngagement: "Engagement Mobile",
        retention: "Rétention",
        previousQuarter: "Par rapport au trimestre précédent",
        mobileUsage: "Augmentation de l'utilisation mobile",
        retentionRate: "Taux de rétention sur 30 jours",
        
        // Education
        manageAvailability: "Gérer vos créneaux de disponibilité",
        courseTraining: "Gestion des cours et formations",
        
        // Lottery
        lotteryManagement: "Gestion des tirages au sort et des lots associés",
        
        // Common
        loadingCourses: "Chargement des cours...",
        loadingMonthlyReports: "Chargement des rapports mensuels...",
        loadingDataAnalysis: "Chargement des analyses de données...",
        loadingTrends: "Chargement des tendances...",
        loadingMeetings: "Chargement des réunions...",
        noDataAvailable: "Aucune donnée disponible",
        noCourses: "Vous n'êtes inscrit à aucun cours pour le moment.",
        noMeetings: "Aucune réunion disponible",
        errorLoading: "Une erreur est survenue lors du chargement des données",
        viewDetails: "Voir détails",
        edit: "Éditer",
        modify: "Modifier",
        cancel: "Annuler",
        update: "Mettre à jour",
        create: "Créer",
        add: "Ajouter",
        delete: "Supprimer",
        price: "Prix",
        duration: "Durée",
        date: "Date",
        time: "Heure",
        searchPlaceholder: "Rechercher...",
        finalized: "Finalisé le",
        currentlyBeingFinalized: "En cours de finalisation",
        january: "Janvier",
        february: "Février",
        march: "Mars",
        minutes: "minutes",
        hours: "heures",
        students: "étudiants",
        noDescription: "Aucune description disponible",
        
        // Meeting status
        active: "En cours",
        scheduled: "Programmé",
        past: "Terminé",
        
        // Course modal
        addCourse: "Ajouter un nouveau cours",
        editCourse: "Modifier le cours",
        courseDetails: "Détails du cours",
        courseTitle: "Titre du cours",
        level: "Niveau",
        hours: "Nombre d'heures",
        totalDuration: "Durée totale du cours en heures",
        courseFiles: "Fichiers du cours",
        acceptedFormats: "Formats acceptés: PDF, MP4, ZIP (max 50MB)",
        
        // Course levels
        beginner: "Débutant",
        intermediate: "Intermédiaire",
        advanced: "Avancé",
        
        // Availability
        createAvailability: "Créer une disponibilité",
        startDateTime: "Date et heure de début",
        endDateTime: "Date et heure de fin",
        commissionRate: "Taux de commission (%)",
        
        // Meeting
        join: "Rejoindre",
        viewRecording: "Voir l'enregistrement",
        createMeeting: "Créer une nouvelle réunion",
        
        // Appointment
        createAppointment: "Créer un rendez-vous",
        
        // Video conferencing
        videoConferencing: "Visioconférence et réunions virtuelles"
    }
};

// Fonction simplifiée pour ajouter les attributs data-translate au chargement initial
function addTranslateAttributes() {
    // Menu principal et catégories
    document.querySelectorAll('.menu-category').forEach(el => {
        const text = el.textContent.trim().toLowerCase();
        if (text === 'main menu') el.setAttribute('data-translate', 'mainMenu');
        else if (text === 'education') el.setAttribute('data-translate', 'education');
        else if (text === 'lottery') el.setAttribute('data-translate', 'lottery');
    });
    
    // Éléments du menu
    document.querySelectorAll('.menu-text').forEach(el => {
        const text = el.textContent.trim().toLowerCase();
        if (text === 'dashboard') el.setAttribute('data-translate', 'dashboard');
        else if (text === 'statistics') el.setAttribute('data-translate', 'statistics');
        else if (text === 'courses') el.setAttribute('data-translate', 'courses');
        else if (text === 'teacher') el.setAttribute('data-translate', 'teacher');
        else if (text === 'appointment') el.setAttribute('data-translate', 'appointment');
        else if (text === 'draws') el.setAttribute('data-translate', 'draws');
        else if (text === 'meet') el.setAttribute('data-translate', 'meet');
    });
    
    // Titre de la page
    if (document.querySelector('.page-title')) {
        const pageTitle = document.querySelector('.page-title').textContent.trim().toLowerCase();
        if (pageTitle === 'dashboard') document.querySelector('.page-title').setAttribute('data-translate', 'dashboard');
        else if (pageTitle === 'courses') document.querySelector('.page-title').setAttribute('data-translate', 'courses');
        else if (pageTitle === 'teacher') document.querySelector('.page-title').setAttribute('data-translate', 'teacher');
        else if (pageTitle === 'appointment') document.querySelector('.page-title').setAttribute('data-translate', 'appointment');
        else if (pageTitle === 'draws') document.querySelector('.page-title').setAttribute('data-translate', 'draws');
        else if (pageTitle === 'meet') document.querySelector('.page-title').setAttribute('data-translate', 'meet');
    }
    
    // Dashboard
    if (document.querySelector('.welcome-text h3')) {
        document.querySelector('.welcome-text h3').setAttribute('data-translate', 'welcome');
    }
    
    // Métriques et cartes
    document.querySelectorAll('.metric-label').forEach((el, index) => {
        if (index === 0) el.setAttribute('data-translate', 'fundsCollected');
        else if (index === 1) el.setAttribute('data-translate', 'growthRate');
    });
    
    document.querySelectorAll('.card-title').forEach(el => {
        if (el.textContent.includes('Scholarships')) {
            el.setAttribute('data-translate', 'activeScholarships');
        } else if (el.textContent.includes('Ticket')) {
            el.setAttribute('data-translate', 'ticketSales');
        }
    });
    
    document.querySelectorAll('.card-label').forEach(el => {
        if (el.textContent.includes('Student')) {
            el.setAttribute('data-translate', 'beneficiaryStudents');
        } else if (el.textContent.includes('Report')) {
            el.setAttribute('data-translate', 'monthlyReports');
        }
    });
    
    // Sections contenu
    document.querySelectorAll('.content-title').forEach(el => {
        const title = el.textContent.trim().toLowerCase();
        if (title === 'availability') el.setAttribute('data-translate', 'availability');
        else if (title === 'meet') el.setAttribute('data-translate', 'meet');
        else if (title === 'monthly reports') el.setAttribute('data-translate', 'monthlyReports');
        else if (title === 'data analysis') el.setAttribute('data-translate', 'dataAnalysis');
        else if (title === 'trends') el.setAttribute('data-translate', 'trends');
        else if (title === 'courses' || title === 'cours') el.setAttribute('data-translate', 'courses');
    });
    
    // Descriptions des sections
    document.querySelectorAll('.content-description').forEach(el => {
        const desc = el.textContent.trim();
        if (desc.includes('Manage your availability slots')) {
            el.setAttribute('data-translate', 'manageAvailability');
        } else if (desc.includes('Course and Training Management')) {
            el.setAttribute('data-translate', 'courseTraining');
        } else if (desc.includes('Video conferencing')) {
            el.setAttribute('data-translate', 'videoConferencing');
        } else if (desc.includes('Monthly Performance')) {
            el.setAttribute('data-translate', 'monthlyPerformance');
        } else if (desc.includes('Advanced Data Analysis')) {
            el.setAttribute('data-translate', 'advancedAnalysis');
        } else if (desc.includes('Analysis of Emerging Trends')) {
            el.setAttribute('data-translate', 'trendsDescription');
        } else if (desc.includes('Gestion des tirages')) {
            el.setAttribute('data-translate', 'lotteryManagement');
        }
    });
    
    // Boutons et actions
    document.querySelectorAll('button').forEach(btn => {
        const text = btn.textContent.trim().toLowerCase();
        if (text === 'view details' || text === 'voir détails') btn.setAttribute('data-translate', 'viewDetails');
        else if (text === 'edit' || text === 'éditer') btn.setAttribute('data-translate', 'edit');
        else if (text === 'modify' || text === 'modifier') btn.setAttribute('data-translate', 'modify');
        else if (text === 'cancel' || text === 'annuler') btn.setAttribute('data-translate', 'cancel');
        else if (text === 'update' || text === 'mettre à jour') btn.setAttribute('data-translate', 'update');
        else if (text === 'create' || text === 'créer') btn.setAttribute('data-translate', 'create');
        else if (text === 'add' || text === 'ajouter') btn.setAttribute('data-translate', 'add');
        else if (text === 'delete' || text === 'supprimer') btn.setAttribute('data-translate', 'delete');
        else if (text === 'join' || text === 'rejoindre') btn.setAttribute('data-translate', 'join');
        else if (text.includes('recording')) btn.setAttribute('data-translate', 'viewRecording');
        else if (text.includes('add a course')) btn.setAttribute('data-translate', 'addCourse');
        else if (text.includes('create availability')) btn.setAttribute('data-translate', 'createAvailability');
        else if (text.includes('créer un rendez-vous')) btn.setAttribute('data-translate', 'createAppointment');
    });
    
    // Messages de chargement
    document.querySelectorAll('.loading-data p, .loading-courses p, .loading-teacher p').forEach(el => {
        const text = el.textContent.trim().toLowerCase();
        if (text.includes('cours') || text.includes('course')) {
            el.setAttribute('data-translate', 'loadingCourses');
        } else if (text.includes('meeting') || text.includes('réunion')) {
            el.setAttribute('data-translate', 'loadingMeetings');
        }
    });
    
    // Messages d'erreur et d'absence de données
    document.querySelectorAll('.no-data, .no-courses').forEach(el => {
        if (el.textContent.includes('cours') || el.textContent.includes('inscrit')) {
            el.setAttribute('data-translate', 'noCourses');
        } else if (el.textContent.includes('meeting') || el.textContent.includes('réunion')) {
            el.setAttribute('data-translate', 'noMeetings');
        } else {
            el.setAttribute('data-translate', 'noDataAvailable');
        }
    });
    
    document.querySelectorAll('.error-state, .error-loading').forEach(el => {
        el.setAttribute('data-translate', 'errorLoading');
    });
    
    // Formulaires
    document.querySelectorAll('label').forEach(label => {
        const text = label.textContent.trim().toLowerCase();
        if (text.includes('titre du cours') || text.includes('course title')) {
            label.setAttribute('data-translate', 'courseTitle');
        } else if (text.includes('niveau') || text.includes('level')) {
            label.setAttribute('data-translate', 'level');
        } else if (text.includes("nombre d'heures") || text.includes('number of hours')) {
            label.setAttribute('data-translate', 'hours');
        } else if (text.includes('prix') || text.includes('price')) {
            label.setAttribute('data-translate', 'price');
        } else if (text.includes('fichiers du cours') || text.includes('course files')) {
            label.setAttribute('data-translate', 'courseFiles');
        } else if (text.includes('date')) {
            label.setAttribute('data-translate', 'date');
        } else if (text.includes('heure') || text.includes('time')) {
            label.setAttribute('data-translate', 'time');
        } else if (text.includes('durée') || text.includes('duration')) {
            label.setAttribute('data-translate', 'duration');
        } else if (text.includes('start date') || text.includes('date de début')) {
            label.setAttribute('data-translate', 'startDateTime');
        } else if (text.includes('end date') || text.includes('date de fin')) {
            label.setAttribute('data-translate', 'endDateTime');
        } else if (text.includes('commission')) {
            label.setAttribute('data-translate', 'commissionRate');
        }
    });
    
    // Infobulles dans les formulaires
    document.querySelectorAll('small.hint').forEach(small => {
        const text = small.textContent.trim().toLowerCase();
        if (text.includes('durée totale') || text.includes('total duration')) {
            small.setAttribute('data-translate', 'totalDuration');
        } else if (text.includes('formats acceptés') || text.includes('accepted formats')) {
            small.setAttribute('data-translate', 'acceptedFormats');
        }
    });
    
    // Titres des modals
    document.querySelectorAll('.modal-content h3').forEach(heading => {
        const text = heading.textContent.trim().toLowerCase();
        if (text.includes('ajouter un nouveau cours') || text.includes('add a new course')) {
            heading.setAttribute('data-translate', 'addCourse');
        } else if (text.includes('modifier le cours') || text.includes('edit course')) {
            heading.setAttribute('data-translate', 'editCourse');
        } else if (text.includes('détails du cours') || text.includes('course details')) {
            heading.setAttribute('data-translate', 'courseDetails');
        } else if (text.includes('create a new availability') || text.includes('créer une disponibilité')) {
            heading.setAttribute('data-translate', 'createAvailability');
        }
    });
}

// Fonction pour changer la langue
function changeLanguage(lang) {
    // Sauvegarder la préférence
    localStorage.setItem('preferredLanguage', lang);
    
    // Récupérer les traductions
    const t = translations[lang];
    if (!t) return; // Si langue non supportée
    
    // Essayer d'ajouter les attributs data-translate s'ils n'existent pas encore
    addTranslateAttributes();
    
    // Mettre à jour les éléments avec attributs data-translate
    document.querySelectorAll('[data-translate]').forEach(el => {
        const key = el.getAttribute('data-translate');
        if (t[key]) {
            el.textContent = t[key];
        }
    });
    
    // Traduire spécifiquement les éléments dynamiques qui n'ont pas d'attributs data-translate
    translateDynamicElements(t);
    
    // Traduire les placeholders
    document.querySelectorAll('input[placeholder], textarea[placeholder]').forEach(el => {
        if (el.classList.contains('search-input')) {
            el.placeholder = t.searchPlaceholder || 'Search...';
        }
    });
    
    // Traduire les messages de chargement
    document.querySelectorAll('.loading-data p, .loading-courses p, .loading-teacher p').forEach(el => {
        if (el.textContent.includes('cours') || el.textContent.includes('course')) {
            el.textContent = t.loadingCourses || 'Loading courses...';
        } else if (el.textContent.includes('reports') || el.textContent.includes('rapport')) {
            el.textContent = t.loadingMonthlyReports || 'Loading monthly reports...';
        } else if (el.textContent.includes('analysis') || el.textContent.includes('analyse')) {
            el.textContent = t.loadingDataAnalysis || 'Loading data analysis...';
        } else if (el.textContent.includes('trends') || el.textContent.includes('tendance')) {
            el.textContent = t.loadingTrends || 'Loading trends...';
        } else if (el.textContent.includes('meeting') || el.textContent.includes('réunion')) {
            el.textContent = t.loadingMeetings || 'Loading meeting rooms...';
        }
    });
    
    // Traduire les messages d'erreur et d'absence de données
    document.querySelectorAll('.no-data, .no-courses').forEach(el => {
        if (el.textContent.includes('cours') || el.textContent.includes('inscrit')) {
            el.textContent = t.noCourses;
        } else if (el.textContent.includes('meeting') || el.textContent.includes('réunion')) {
            el.textContent = t.noMeetings;
        } else {
            el.textContent = t.noDataAvailable;
        }
    });
    
    document.querySelectorAll('.error-state, .error-loading').forEach(el => {
        el.textContent = t.errorLoading;
    });
}

// Traduire les éléments qui sont ajoutés dynamiquement
function translateDynamicElements(translations) {
    // Traduire les cartes de cours
    document.querySelectorAll('.content-card').forEach(card => {
        // Trouver et traduire les boutons dans les cartes
        const viewBtn = card.querySelector('.view-course-btn');
        if (viewBtn) viewBtn.textContent = translations.viewDetails || 'View details';
        
        const editBtn = card.querySelector('.edit-btn');
        if (editBtn) editBtn.textContent = translations.modify || 'Modify';
        
        const cancelBtn = card.querySelector('.cancel-appointment-btn');
        if (cancelBtn) cancelBtn.textContent = translations.cancel || 'Cancel';
        
        const joinBtn = card.querySelector('.join-meeting-btn');
        if (joinBtn) joinBtn.textContent = translations.join || 'Join';
        
        const recordingBtn = card.querySelector('.view-recording-btn');
        if (recordingBtn) recordingBtn.textContent = translations.viewRecording || 'View recording';
        
        // Traduire les badges de statut des réunions
        const statusSpan = card.querySelector('.meeting-status');
        if (statusSpan) {
            if (statusSpan.classList.contains('status-active')) {
                statusSpan.textContent = translations.active || 'Ongoing';
            } else if (statusSpan.classList.contains('status-scheduled')) {
                statusSpan.textContent = translations.scheduled || 'Scheduled';
            } else if (statusSpan.classList.contains('status-past')) {
                statusSpan.textContent = translations.past || 'Completed';
            }
        }
        
        // Traduire les mots communs dans le contenu des cartes
        const valueElem = card.querySelector('.content-card-value');
        if (valueElem) {
            let valueText = valueElem.textContent;
            if (valueText.includes('étudiant') || valueText.includes('student')) {
                valueText = valueText.replace(/étudiant(s)?|student(s)?/gi, translations.students || 'students');
                valueElem.textContent = valueText;
            }
            
            if (valueText.includes('heure') || valueText.includes('hour')) {
                valueText = valueText.replace(/heure(s)?|hour(s)?/gi, translations.hours || 'hours');
                valueElem.textContent = valueText;
            }
        }
        
        // Traduire les descriptions
        const descElem = card.querySelector('.content-card-desc');
        if (descElem) {
            let descText = descElem.textContent;
            
            // Traduire les dates finalisées
            if (descText.includes('Finalisé le') || descText.includes('Finalized on')) {
                descText = descText.replace(/Finalisé le|Finalized on/gi, translations.finalized || 'Finalized on');
                descElem.textContent = descText;
            }
            
            // Traduire les états en cours
            if (descText.includes('Currently being finalized') || descText.includes('En cours de finalisation')) {
                descElem.textContent = translations.currentlyBeingFinalized || 'Currently being finalized';
            }
            
            // Traduire "Aucune description"
            if (descText === 'Aucune description' || descText === 'No description') {
                descElem.textContent = translations.noDescription || 'No description';
            }
            
            // Traduire les minutes/heures dans les descriptions
            if (descText.includes('minutes')) {
                descText = descText.replace('minutes', translations.minutes || 'minutes');
                descElem.textContent = descText;
            }
            
            // Traduire les mois
            if (descText.includes('January') || descText.includes('Janvier')) {
                descText = descText.replace(/January|Janvier/gi, translations.january || 'January');
                descElem.textContent = descText;
            }
            if (descText.includes('February') || descText.includes('Février')) {
                descText = descText.replace(/February|Février/gi, translations.february || 'February');
                descElem.textContent = descText;
            }
            if (descText.includes('March') || descText.includes('Mars')) {
                descText = descText.replace(/March|Mars/gi, translations.march || 'March');
                descElem.textContent = descText;
            }
        }
    });
    
    // Traduire "Créer un nouveau rendez-vous" dans la carte add-new-card
    const addNewCardText = document.querySelector('.add-new-card .add-text');
    if (addNewCardText) {
        addNewCardText.textContent = translations.createMeeting;
    }
    
    // Mettre à jour les options du sélecteur de niveau dans les modals
    document.querySelectorAll('select[name="niveau"]').forEach(select => {
        const options = select.querySelectorAll('option');
        options.forEach(option => {
            if (option.value === 'débutant' || option.value === 'beginner') {
                option.textContent = translations.beginner || 'Beginner';
            } else if (option.value === 'intermédiaire' || option.value === 'intermediate') {
                option.textContent = translations.intermediate || 'Intermediate';
            } else if (option.value === 'avancé' || option.value === 'advanced') {
                option.textContent = translations.advanced || 'Advanced';
            }
        });
    });
}

// Fonction pour observer les changements dans le DOM
function observeDOMChanges() {
    // Créer un observateur de mutations
    const observer = new MutationObserver(function(mutations) {
        // Vérifier si des contenus pertinents ont été ajoutés
        let contentAdded = false;
        
        mutations.forEach(function(mutation) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                // Vérifier si des éléments pertinents ont été ajoutés
                mutation.addedNodes.forEach(function(node) {
                    if (node.nodeType === 1) { // Élément DOM
                        if (node.classList && 
                            (node.classList.contains('content-card') || 
                             node.classList.contains('page-content') || 
                             node.classList.contains('content-body') ||
                             node.classList.contains('modal-content'))) {
                            contentAdded = true;
                        }
                    }
                });
            }
        });
        
        // Si du contenu pertinent a été ajouté, traduire à nouveau les éléments
        if (contentAdded) {
            const lang = localStorage.getItem('preferredLanguage') || 'en';
            if (translations[lang]) {
                setTimeout(() => {
                    addTranslateAttributes();
                    translateDynamicElements(translations[lang]);
                }, 100);
            }
        }
    });
    
    // Observer tout le document pour les changements
    observer.observe(document.body, {
        childList: true,
        subtree: true});
}

// Initialisation au chargement
document.addEventListener('DOMContentLoaded', function() {
    // Ajouter les attributs data-translate initiaux
    addTranslateAttributes();
    
    // Observer les changements du DOM pour les traductions
    observeDOMChanges();
    
    // Définir et appliquer la langue
    const langSelect = document.getElementById('language-select');
    const preferredLang = localStorage.getItem('preferredLanguage') || 'en';
    
    if (langSelect) {
        // Limiter les options à l'anglais et au français
        while (langSelect.options.length) {
            langSelect.remove(0);
        }
        
        // Ajouter uniquement les options pour l'anglais et le français
        const frOption = document.createElement('option');
        frOption.value = 'fr';
        frOption.textContent = 'Français';
        
        const enOption = document.createElement('option');
        enOption.value = 'en';
        enOption.textContent = 'English';
        
        langSelect.add(enOption);
        langSelect.add(frOption);
        
        // Sélectionner la langue préférée
        langSelect.value = preferredLang;
        
        langSelect.addEventListener('change', (e) => {
            changeLanguage(e.target.value);
        });
    }
    
    // Appliquer la langue initiale
    changeLanguage(preferredLang);
    
    // Redéfinir les fonctions de chargement pour appliquer les traductions
    redefineLoaderFunctions();
    
    // Redéfinir les fonctions d'affichage pour appliquer les traductions
    redefineDisplayFunctions();
});

// Fonction pour réappliquer la traduction après un changement de page
function translatePageAfterChange() {
    const lang = localStorage.getItem('preferredLanguage') || 'en';
    setTimeout(() => {
        addTranslateAttributes();
        changeLanguage(lang);
    }, 200);
}

// Fonction pour redéfinir les fonctions de chargement des données
function redefineLoaderFunctions() {
    // Réappliquer la traduction après le chargement des données du dashboard
    if (window.loadDashboardData) {
        const originalLoadDashboardData = window.loadDashboardData;
        window.loadDashboardData = function() {
            return originalLoadDashboardData().then(() => {
                translatePageAfterChange();
            });
        };
    }
    
    // Réappliquer la traduction après le chargement des rapports mensuels
    if (window.loadMonthlyReportsData) {
        const originalLoadMonthlyReportsData = window.loadMonthlyReportsData;
        window.loadMonthlyReportsData = function() {
            return originalLoadMonthlyReportsData().then(() => {
                translatePageAfterChange();
            });
        };
    }
    
    // Réappliquer la traduction après le chargement des analyses de données
    if (window.loadDataAnalysisData) {
        const originalLoadDataAnalysisData = window.loadDataAnalysisData;
        window.loadDataAnalysisData = function() {
            return originalLoadDataAnalysisData().then(() => {
                translatePageAfterChange();
            });
        };
    }
    
    // Réappliquer la traduction après le chargement des tendances
    if (window.loadTrendsData) {
        const originalLoadTrendsData = window.loadTrendsData;
        window.loadTrendsData = function() {
            return originalLoadTrendsData().then(() => {
                translatePageAfterChange();
            });
        };
    }
}

// Fonction pour redéfinir les fonctions d'affichage
function redefineDisplayFunctions() {
    // Réappliquer la traduction après l'affichage des cours
    if (window.displayCourses) {
        const originalDisplayCourses = window.displayCourses;
        window.displayCourses = async function() {
            await originalDisplayCourses();
            translatePageAfterChange();
        };
    }
    
    // Réappliquer la traduction après l'affichage des cours de l'enseignant
    if (window.displayCoursesTeacher) {
        const originalDisplayCoursesTeacher = window.displayCoursesTeacher;
        window.displayCoursesTeacher = async function() {
            await originalDisplayCoursesTeacher();
            translatePageAfterChange();
        };
    }
    
    // Réappliquer la traduction après l'affichage des rendez-vous
    if (window.displayAppointments) {
        const originalDisplayAppointments = window.displayAppointments;
        window.displayAppointments = async function() {
            await originalDisplayAppointments();
            translatePageAfterChange();
        };
    }
    
    // Réappliquer la traduction après l'affichage des disponibilités
    if (window.displayAvailabilities) {
        const originalDisplayAvailabilities = window.displayAvailabilities;
        window.displayAvailabilities = async function() {
            await originalDisplayAvailabilities();
            translatePageAfterChange();
        };
    }
    
    // Réappliquer la traduction après l'affichage des réunions
    if (window.displayMeetings) {
        const originalDisplayMeetings = window.displayMeetings;
        window.displayMeetings = async function() {
            await originalDisplayMeetings();
            translatePageAfterChange();
        };
    }
    
    // Réappliquer la traduction après l'affichage des tirages
    if (window.displayDraws) {
        const originalDisplayDraws = window.displayDraws;
        window.displayDraws = async function() {
            await originalDisplayDraws();
            translatePageAfterChange();
        };
    }
}

// Ajouter des événements pour les changements de page
document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', function() {
        const pageName = this.getAttribute('data-page');
        if (pageName) {
            // Mettre à jour le titre de la page avec traduction
            const t = translations[localStorage.getItem('preferredLanguage') || 'en'];
            if (t && t[pageName]) {
                const pageTitle = document.querySelector('.page-title');
                if (pageTitle) {
                    pageTitle.textContent = t[pageName];
                    pageTitle.setAttribute('data-translate', pageName);
                }
            }
            
            // Appliquer les traductions après le changement de page
            translatePageAfterChange();
        }
    });
});

// Surveiller également les modals lorsqu'ils sont ouverts
function monitorModalOpenings() {
    // Liste des classes de modals à surveiller
    const modalClasses = [
        '.course-modal', 
        '.appointment-edit-modal', 
        '.appointment-create-modal',
        '.availability-edit-modal', 
        '.availability-create-modal',
        '.course-details-modal',
        '.course-edit-modal',
        '.course-enrollment-modal'
    ];
    
    // Observer l'ajout de modals
    const observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                mutation.addedNodes.forEach(function(node) {
                    if (node.nodeType === 1) { // Élément DOM
                        // Vérifier si c'est un modal que nous voulons observer
                        modalClasses.forEach(modalClass => {
                            if (node.classList && node.classList.contains(modalClass.substring(1))) {
                                // Ajouter des attributs data-translate aux éléments du modal
                                addTranslateAttributesToModal(node);
                                
                                // Traduire le contenu du modal
                                const lang = localStorage.getItem('preferredLanguage') || 'en';
                                translateModalContent(node, translations[lang]);
                            }
                        });
                    }
                });
            }
        });
    });
    
    // Observer tout le body pour détecter l'ajout de modals
    observer.observe(document.body, {
        childList: true,
        subtree: false
    });
}

// Fonction pour ajouter des attributs data-translate aux éléments d'un modal
function addTranslateAttributesToModal(modalNode) {
    // Ajouter des attributs data-translate aux titres h3
    modalNode.querySelectorAll('h3, h4').forEach(heading => {
        const text = heading.textContent.trim().toLowerCase();
        
        if (text.includes('ajouter un nouveau cours') || text.includes('add a new course')) {
            heading.setAttribute('data-translate', 'addCourse');
        } else if (text.includes('modifier le cours') || text.includes('edit course')) {
            heading.setAttribute('data-translate', 'editCourse');
        } else if (text.includes('détails du cours') || text.includes('course details')) {
            heading.setAttribute('data-translate', 'courseDetails');
        } else if (text.includes('create a new availability') || text.includes('créer une disponibilité')) {
            heading.setAttribute('data-translate', 'createAvailability');
        }
    });
    
    // Ajouter des attributs data-translate aux labels
    modalNode.querySelectorAll('label').forEach(label => {
        const text = label.textContent.trim().toLowerCase();
        
        if (text.includes('titre du cours') || text.includes('course title')) {
            label.setAttribute('data-translate', 'courseTitle');
        } else if (text.includes('niveau') || text.includes('level')) {
            label.setAttribute('data-translate', 'level');
        } else if (text.includes("nombre d'heures") || text.includes('number of hours')) {
            label.setAttribute('data-translate', 'hours');
        } else if (text.includes('prix') || text.includes('price')) {
            label.setAttribute('data-translate', 'price');
        } else if (text.includes('fichiers du cours') || text.includes('course files')) {
            label.setAttribute('data-translate', 'courseFiles');
        } else if (text.includes('date')) {
            label.setAttribute('data-translate', 'date');
        } else if (text.includes('heure') || text.includes('time')) {
            label.setAttribute('data-translate', 'time');
        } else if (text.includes('durée') || text.includes('duration')) {
            label.setAttribute('data-translate', 'duration');
        } else if (text.includes('start date') || text.includes('date de début')) {
            label.setAttribute('data-translate', 'startDateTime');
        } else if (text.includes('end date') || text.includes('date de fin')) {
            label.setAttribute('data-translate', 'endDateTime');
        } else if (text.includes('commission')) {
            label.setAttribute('data-translate', 'commissionRate');
        }
    });
    
    // Ajouter des attributs data-translate aux boutons
    modalNode.querySelectorAll('button').forEach(btn => {
        const text = btn.textContent.trim().toLowerCase();
        
        if (text === 'cancel' || text === 'annuler') {
            btn.setAttribute('data-translate', 'cancel');
        } else if (text === 'update' || text === 'mettre à jour') {
            btn.setAttribute('data-translate', 'update');
        } else if (text === 'create' || text === 'créer') {
            btn.setAttribute('data-translate', 'create');
        } else if (text === 'save' || text === 'sauvegarder' || text === 'enregistrer') {
            btn.setAttribute('data-translate', 'save');
        } else if (text === 'delete' || text === 'supprimer') {
            btn.setAttribute('data-translate', 'delete');
        } else if (text === 'close' || text === 'fermer') {
            btn.setAttribute('data-translate', 'close');
        }
    });
    
    // Ajouter des attributs data-translate aux petits textes d'aide
    modalNode.querySelectorAll('small').forEach(small => {
        const text = small.textContent.trim().toLowerCase();
        
        if (text.includes('durée totale') || text.includes('total duration')) {
            small.setAttribute('data-translate', 'totalDuration');
        } else if (text.includes('formats acceptés') || text.includes('accepted formats')) {
            small.setAttribute('data-translate', 'acceptedFormats');
        }
    });
}

// Traduire le contenu spécifique des modals
function translateModalContent(modalNode, t) {
    if (!t) return;
    
    // Traduire les éléments avec data-translate
    modalNode.querySelectorAll('[data-translate]').forEach(el => {
        const key = el.getAttribute('data-translate');
        if (t[key]) {
            el.textContent = t[key];
        }
    });
    
    // Traduire les options de sélection pour le niveau
    modalNode.querySelectorAll('select[name="niveau"] option').forEach(option => {
        const value = option.value.toLowerCase();
        if (value === 'débutant' || value === 'beginner') {
            option.textContent = t.beginner || 'Beginner';
        } else if (value === 'intermédiaire' || value === 'intermediate') {
            option.textContent = t.intermediate || 'Intermediate';
        } else if (value === 'avancé' || value === 'advanced') {
            option.textContent = t.advanced || 'Advanced';
        }
    });
    
    // Traduire les placeholders
    modalNode.querySelectorAll('input[placeholder], textarea[placeholder]').forEach(el => {
        const placeholder = el.placeholder.toLowerCase();
        
        if (placeholder.includes('search') || placeholder.includes('rechercher')) {
            el.placeholder = t.searchPlaceholder || 'Search...';
        }
    });
}


