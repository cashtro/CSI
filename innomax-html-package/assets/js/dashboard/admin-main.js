// Admin dashboard controller. Extracted verbatim from dashboard-admin.ejs
// (was ~619 inline lines) to de-monolith the view. Classic script at the
// same DOM position, so globals/timing are unchanged.

        document.addEventListener('DOMContentLoaded', function() {
            // Gestion du modal Portfolio
            const addPortfolioBtn = document.getElementById('add-portfolio-btn');
            const portfolioModal = document.querySelector('.portfolio-modal');
            const cancelPortfolioBtn = portfolioModal?.querySelector('.cancel-btn');
            
            if (addPortfolioBtn && portfolioModal) {
                addPortfolioBtn.addEventListener('click', () => {
                    portfolioModal.style.display = 'flex';
                });
                
                if (cancelPortfolioBtn) {
                    cancelPortfolioBtn.addEventListener('click', () => {
                        portfolioModal.style.display = 'none';
                    });
                }
            }
        
            // Chargement des projets portfolio
           
        // Définir loadPortfolio comme fonction globale
function loadPortfolio() {
    try {
        fetch('/api/portfolio/portfolio')
            .then(response => {
                if (!response.ok) {
                    return response.text().then(text => {
                        throw new Error(`Erreur ${response.status}: ${text}`);
                    });
                }
                return response.json();
            })
            .then(portfolioItems => {
                renderPortfolio(portfolioItems);
            })
            .catch(error => {
                console.error('Erreur détaillée:', error);
                document.getElementById('portfolio-list').innerHTML = 
                    `<div class="error-message">${error.message}</div>`;
            });
    } catch (error) {
        console.error('Erreur détaillée:', error);
        document.getElementById('portfolio-list').innerHTML = 
            `<div class="error-message">${error.message}</div>`;
    }
}
            // Affichage des projets
            function renderPortfolio(items) {
                const portfolioList = document.getElementById('portfolio-list');
                
                if (items.length === 0) {
                    portfolioList.innerHTML = '<div class="empty-message">Aucun projet dans le portfolio</div>';
                    return;
                }
                
                portfolioList.innerHTML = items.map(item => `
                    <div class="portfolio-item">
                        <div class="portfolio-image">
                            ${item.image_portfolio ? `<img src="${item.image_portfolio}" alt="${item.title}">` : ''}
                        </div>
                        <div class="portfolio-info">
                            <h3>${item.title}</h3>
                            <p class="genre">${item.genre}</p>
                            <a href="${item.urlPortfolio}" target="_blank" class="portfolio-link">Voir le projet</a>
                        </div>
                        <div class="portfolio-actions">
                            <button class="edit-btn" data-id="${item.id}">Modify</button>
                            <button class="delete-btn" data-id="${item.id}">Delete</button>
                        </div>
                    </div>
                `).join('');
                
                
                // Ajout des écouteurs d'événements pour les boutons
                document.querySelectorAll('.delete-btn').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        if (confirm('Delete this project ?')) {
                            try {
                                const response = await fetch(`/api/portfolio/portfolio/${e.target.dataset.id}`, {
                                    method: 'DELETE',
                                    headers: {
                                        'Authorization': `Bearer ${sessionStorage.getItem('accessToken') || localStorage.getItem('accessToken') }`
                                    }
                                });
                                
                                if (response.ok) {
                                    loadPortfolio();
                                } else {
                                    alert('Erreur lors de la suppression');
                                }
                            } catch (error) {
                                console.error('Erreur:', error);
                            }
                        }
                    });
                });

                document.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const projectId = e.target.dataset.id;
            try {
                const response = await fetch(`/api/portfolio/portfolio/${projectId}`);
                
                if (!response.ok) throw new Error('Projet non trouvé');
                
                const projectData = await response.json();
                openEditModal(projectData);
            } catch (error) {
                console.error('Erreur:', error);
                alert('Impossible de charger les données du projet');
            }
        });
    });

                
            }
        
            // Soumission du formulaire d'ajout
            const portfolioForm = document.getElementById('add-portfolio-form');
            if (portfolioForm) {
                portfolioForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    
                    const formData = new FormData(portfolioForm);
                    
                    try {
                        const response = await fetch('/api/portfolio/portfolio', {
                            method: 'POST',
                            body: formData,
                            headers: {
                                'Authorization': `Bearer ${sessionStorage.getItem('accessToken') || localStorage.getItem('accessToken')}`
                            }
                        });
                        
                        if (response.ok) {
                            portfolioModal.style.display = 'none';
                            portfolioForm.reset();
                            loadPortfolio();
                        } else {
                            const error = await response.json();
                            alert(error.error || 'Erreur lors de l\'ajout');
                        }
                    } catch (error) {
                        console.error('Erreur:', error);
                    }
                });
            }
        
            // Charger le portfolio au démarrage
            loadPortfolio();
        });


// Fonction pour ouvrir le modal d'édition du portfolio
function openEditModal(projectData) {
    const editModal = document.querySelector('.portfolio-edit-modal');
    const form = document.getElementById('edit-portfolio-form');
    
    if (!editModal || !form) {
        console.error('Modal d\'édition ou formulaire non trouvé');
        return;
    }
    
    // Remplir le formulaire avec les données du projet
    document.getElementById('edit-portfolio-id').value = projectData.id;
    document.getElementById('edit-portfolio-title').value = projectData.title;
    document.getElementById('edit-portfolio-genre').value = projectData.genre;
    document.getElementById('edit-portfolio-url').value = projectData.urlPortfolio;
    
    // Afficher le modal
    editModal.style.display = 'flex';
    
    // Gérer la fermeture du modal
    // D'abord, sélectionner le bon bouton (s'assurer qu'il existe dans votre HTML)
    let cancelBtn = editModal.querySelector('.cancel-btn');
    if (!cancelBtn) {
        // Si .cancel-btn n'existe pas, essayons de trouver .cancel-edit-btn
        cancelBtn = editModal.querySelector('.cancel-edit-btn');
    }
    
    if (cancelBtn) {
        // Supprimer les anciens écouteurs pour éviter les doublons
        const newCancelBtn = cancelBtn.cloneNode(true);
        cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
        
        // Appliquer le style rouge au bouton
        newCancelBtn.style.backgroundColor = '#dc3545';
        newCancelBtn.style.color = 'white';
        newCancelBtn.style.border = 'none';
        newCancelBtn.style.padding = '10px 20px';
        newCancelBtn.style.borderRadius = '4px';
        newCancelBtn.style.cursor = 'pointer';
        
        // Ajouter l'écouteur d'événement
        newCancelBtn.addEventListener('click', () => {
            editModal.style.display = 'none';
        });
    } else {
        console.error('Bouton d\'annulation non trouvé dans le modal');
    }
}

// Modifier la partie qui gère les boutons d'édition
document.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
        const projectId = e.target.dataset.id;
        try {
            const response = await fetch(`/api/portfolio/portfolio/${projectId}`, {
                headers: {
                    'Authorization': `Bearer ${sessionStorage.getItem('accessToken') || localStorage.getItem('accessToken')}`
                }
            });
            
            if (!response.ok) throw new Error('Projet non trouvé');
            
            const projectData = await response.json();
            openEditModal(projectData);
        } catch (error) {
            console.error('Erreur:', error);
            alert('Impossible de charger les données du projet');
        }
    });
});

document.addEventListener('DOMContentLoaded', function() {
    // Modal logic
    const addAchatBtn = document.getElementById('add-achat-btn');
    const achatModal = document.querySelector('.achat-modal');
    const cancelAchatBtn = achatModal?.querySelector('.cancel-btn');
    const achatForm = document.getElementById('add-achat-form');
    let editAchatId = null; // Track edit mode

    // Open modal to add
    if (addAchatBtn && achatModal) {
        addAchatBtn.addEventListener('click', () => {
            achatModal.style.display = 'flex';
            achatForm.reset();
            editAchatId = null;
            document.querySelector('.achat-modal h3').textContent = "Add an Item to the Shop";
            document.querySelector('.achat-modal .submit-btn').textContent = "Add Product";
        });
        if (cancelAchatBtn) {
            cancelAchatBtn.addEventListener('click', () => {
                achatModal.style.display = 'none';
                achatForm.reset();
                editAchatId = null;
            });
        }
    }

    // Submit: add or edit
    if (achatForm) {
        achatForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(achatForm);
            let url = '/api/achats';
            let method = 'POST';
            if (editAchatId) {
                url = `/api/achats/${editAchatId}`;
                method = 'PUT';
            }
            try {
                const response = await fetch(url, {
                    method,
                    body: formData,
                    headers: {
                        'Authorization': `Bearer ${sessionStorage.getItem('accessToken') || localStorage.getItem('accessToken')}`
                    }
                });
                if (response.ok) {
                    achatModal.style.display = 'none';
                    achatForm.reset();
                    loadAchat();
                    editAchatId = null;
                    document.querySelector('.achat-modal h3').textContent = "Add an Item to the Shop";
                    document.querySelector('.achat-modal .submit-btn').textContent = "Add Product";
                } else {
                    const error = await response.json();
                    alert(error.error || 'Error saving item');
                }
            } catch (error) {
                console.error('Error:', error);
            }
        });
    }

    // Load items
    function loadAchat() {
        fetch('/api/achats')
            .then(res => res.json())
            .then(items => renderAchat(items))
            .catch(err => {
                document.getElementById('achat-list').innerHTML = `<div class="error-message">${err.message}</div>`;
            });
    }

    function renderAchat(items) {
        const achatGrid = document.querySelector('.achat-grid');
        if (!items.length) {
            achatGrid.innerHTML = '<div class="empty-message">No items in the shop</div>';
            return;
        }
        achatGrid.innerHTML = items.map(item => `
            <div class="achat-item">
                <div class="achat-image">${item.imageProduit ? `<img src="${item.imageProduit}" alt="${item.nomProduit}">` : ''}</div>
                <div class="achat-info">
                    <h3>${item.nomProduit}</h3>
                    <p>${item.shortDescription}</p>
                    <div class="achat-price">$${item.price}</div>
                </div>
                <div class="achat-actions">
                    <button class="edit-btn" data-id="${item.id}">Edit</button>
                    <button class="delete-btn" data-id="${item.id}">Delete</button>
                </div>
            </div>
        `).join('');

        // DELETE logic
        achatGrid.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = btn.dataset.id;
                if (confirm('Delete this item?')) {
                    try {
                        const res = await fetch(`/api/achats/${id}`, { method: 'DELETE' });
                        if (res.ok) {
                            loadAchat();
                        } else {
                            alert('Error deleting item');
                        }
                    } catch (err) {
                        alert('Error deleting item');
                    }
                }
            });
        });

        // EDIT logic (open modal, pre-fill fields, set edit mode)
        achatGrid.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = btn.dataset.id;
                const item = items.find(i => i.id == id);
                if (!item) return;
                editAchatId = id;
                document.getElementById('nomProduit').value = item.nomProduit;
                document.getElementById('price').value = item.price;
                document.getElementById('shortDescription').value = item.shortDescription || '';
                document.getElementById('fullDescription').value = item.fullDescription || '';
                achatModal.style.display = 'flex';
                document.querySelector('.achat-modal h3').textContent = "Edit Item";
                document.querySelector('.achat-modal .submit-btn').textContent = "Save Changes";
            });
        });
    }

    // Initial load
    loadAchat();
});


// Ajouter la gestion du formulaire d'édition
document.addEventListener('DOMContentLoaded', function() {
    const editForm = document.getElementById('edit-portfolio-form');
    if (editForm) {
        editForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const formData = new FormData(editForm);
            const projectId = formData.get('id');
            
            // Si pas de nouvelle image sélectionnée, créer un objet JSON
            if (!formData.get('file') || formData.get('file').size === 0) {
                const requestData = {
                    title: formData.get('title'),
                    genre: formData.get('genre'),
                    urlPortfolio: formData.get('urlPortfolio')
                };
                
                try {
                    const response = await fetch(`/api/portfolio/portfolio/${projectId}`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${sessionStorage.getItem('accessToken') || localStorage.getItem('accessToken')}`
                        },
                        body: JSON.stringify(requestData)
                    });
                    
                    if (!response.ok) {
                        const errorData = await response.json();
                        throw new Error(errorData.error || 'Erreur lors de la mise à jour');
                    }
                    
                    document.querySelector('.portfolio-edit-modal').style.display = 'none';
                    try {
        fetch('/api/portfolio/portfolio')
            .then(response => {
                if (!response.ok) {
                    return response.text().then(text => {
                        throw new Error(`Erreur ${response.status}: ${text}`);
                    });
                }
                return response.json();
            })
            .then(portfolioItems => {
                const items = portfolioItems;
                const portfolioList = document.getElementById('portfolio-list');
                
                if (items.length === 0) {
                    portfolioList.innerHTML = '<div class="empty-message">Aucun projet dans le portfolio</div>';
                    return;
                }
                
                portfolioList.innerHTML = items.map(item => `
                    <div class="portfolio-item">
                        <div class="portfolio-image">
                            ${item.image_portfolio ? `<img src="${item.image_portfolio}" alt="${item.title}">` : ''}
                        </div>
                        <div class="portfolio-info">
                            <h3>${item.title}</h3>
                            <p class="genre">${item.genre}</p>
                            <a href="${item.urlPortfolio}" target="_blank" class="portfolio-link">Voir le projet</a>
                        </div>
                        <div class="portfolio-actions">
                            <button class="edit-btn" data-id="${item.id}">Modify</button>
                            <button class="delete-btn" data-id="${item.id}">Delete</button>
                        </div>
                    </div>
                `).join('');
                
                
                // Ajout des écouteurs d'événements pour les boutons
                document.querySelectorAll('.delete-btn').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        if (confirm('Delete this project ?')) {
                            try {
                                const response = await fetch(`/api/portfolio/portfolio/${e.target.dataset.id}`, {
                                    method: 'DELETE',
                                    headers: {
                                        'Authorization': `Bearer ${sessionStorage.getItem('accessToken') || localStorage.getItem('accessToken') }`
                                    }
                                });
                                
                                if (response.ok) {
                                    loadPortfolio();
                                } else {
                                    alert('Erreur lors de la suppression');
                                }
                            } catch (error) {
                                console.error('Erreur:', error);
                            }
                        }
                    });
                });

                document.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const projectId = e.target.dataset.id;
            try {
                const response = await fetch(`/api/portfolio/portfolio/${projectId}`);
                
                if (!response.ok) throw new Error('Projet non trouvé');
                
                const projectData = await response.json();
                openEditModal(projectData);
            } catch (error) {
                console.error('Erreur:', error);
                alert('Impossible de charger les données du projet');
            }
        });
    });

            })
            .catch(error => {
                console.error('Erreur détaillée:', error);
                document.getElementById('portfolio-list').innerHTML = 
                    `<div class="error-message">${error.message}</div>`;
            });
    } catch (error) {
        console.error('Erreur détaillée:', error);
        document.getElementById('portfolio-list').innerHTML = 
            `<div class="error-message">${error.message}</div>`;
    }
                } catch (error) {
                    console.error('Erreur:', error);
                    alert(error.message);
                }
            } else {
                // Si nouvelle image, envoyer le FormData directement
                try {
                    const response = await fetch(`/api/portfolio/portfolio/${projectId}`, {
                        method: 'PUT',
                        body: formData,
                        headers: {
                            'Authorization': `Bearer ${sessionStorage.getItem('accessToken') || localStorage.getItem('accessToken')}`
                        }
                    });
                    
                    if (!response.ok) {
                        const errorData = await response.json();
                        throw new Error(errorData.error || 'Erreur lors de la mise à jour');
                    }
                    
                    document.querySelector('.portfolio-edit-modal').style.display = 'none';
                    loadPortfolio();
                } catch (error) {
                    console.error('Erreur:', error);
                    alert(error.message);
                }
            }
        });
    }
});

        // Dictionnaire de traductions
const translations = {
    en: {
        dashboard: "Dashboard",
        statistics: "Statistics",
        programs: "Programs",
        education: "Education",
        courses: "Courses",
        portfolio: "Portfolio",
        lottery: "Lottery",
        draws: "Raffle",
        welcome: "Welcome",
        // Ajoutez toutes les autres traductions nécessaires
    },
    fr: {
        dashboard: "Tableau de bord",
        statistics: "Statistiques",
        programs: "Programmes",
        education: "Éducation",
        courses: "Cours",
        portfolio: "Portfolio",
        lottery: "Loterie",
        draws: "Tirages",
        welcome: "Bienvenue",
        // Ajoutez toutes les autres traductions nécessaires
    },
    es: {
        dashboard: "Panel",
        statistics: "Estadísticas",
        // ... autres traductions espagnoles
    },
    de: {
        dashboard: "Dashboard",
        statistics: "Statistiken",
        // ... autres traductions allemandes
    }
};

// Fonction pour changer la langue
function changeLanguage(lang) {
    // Sauvegarder la préférence
    localStorage.setItem('preferredLanguage', lang);
    
    // Récupérer les traductions
    const t = translations[lang];
    
    // Mettre à jour les éléments de l'interface
    document.querySelectorAll('[data-translate]').forEach(el => {
        const key = el.getAttribute('data-translate');
        if (t[key]) {
            el.textContent = t[key];
        }
    });
    
    // Mettre à jour les attributs alt, placeholder, etc.
    document.querySelector('.search-input').placeholder = t.searchPlaceholder || 'Search...';
}

// Initialisation au chargement
document.addEventListener('DOMContentLoaded', function() {
    const langSelect = document.getElementById('language-select');
    const preferredLang = localStorage.getItem('preferredLanguage') || 'en';
    
    // Définir la langue sélectionnée
    if (langSelect) {
        langSelect.value = preferredLang;
        langSelect.addEventListener('change', (e) => {
            changeLanguage(e.target.value);
        });
    }
    
    // Appliquer la langue
    changeLanguage(preferredLang);
});


document.addEventListener('DOMContentLoaded', function() {
    // Gestion de l'aperçu d'image de cours
    const courseImageInput = document.getElementById('course-image');
    const previewContainer = document.getElementById('course-image-preview');
    const previewImg = document.getElementById('preview-img');
    const placeholder = previewContainer?.querySelector('.upload-placeholder');

    if (courseImageInput && previewContainer && previewImg && placeholder) {
        // Clic sur la zone d'aperçu déclenche l'input file
        previewContainer.addEventListener('click', function() {
            courseImageInput.click();
        });

        // Afficher l'aperçu lors de la sélection de fichier
        courseImageInput.addEventListener('change', function() {
            if (this.files && this.files[0]) {
                const reader = new FileReader();
                
                reader.onload = function(e) {
                    previewImg.src = e.target.result;
                    previewImg.style.display = 'block';
                    placeholder.style.display = 'none';
                };
                
                reader.readAsDataURL(this.files[0]);
            }
        });
    }
});

