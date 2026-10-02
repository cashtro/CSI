// Sélectionner les éléments DOM
const menuItems = document.querySelectorAll('.menu-item');
const pageTitle = document.querySelector('.page-title');
const adminBtn = document.getElementById('adminBtn');
const adminModal = document.getElementById('adminModal');
const closeModal = document.getElementById('closeModal');
const menuItemsWithSubmenu = document.querySelectorAll('.menu-item.has-submenu');
const pageContents = document.querySelectorAll('.page-content');




// Lottery

// Afficher le modal
document.getElementById('add-lottery-btn').addEventListener('click', function () {
    document.querySelector('.lottery-modal').style.display = 'flex';
    document.body.style.overflow = 'hidden'; // Bloquer le défilement
});

// Fermer le modal
document.querySelectorAll('.cancel-btn, .lottery-modal').forEach(element => {
    element.addEventListener('click', (e) => {
        if (e.target === element || e.target.classList.contains('cancel-btn')) {
            document.querySelector('.lottery-modal').style.display = 'none';
            //document.body.style.overflow = 'auto'; // Rétablir le défilement
            resetForm();
        }
    });
});

// Fonction pour récupérer les tirages depuis l'API
async function fetchLotteries() {
    try {
        const response = await fetch('/api/lottery/lotteryData', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
            }
        });
        if (!response.ok) {
            throw new Error('Erreur lors du chargement des tirages');
        }
        return await response.json();
    } catch (error) {
        console.error('Erreur:', error);
        return [];
    }
}

// Fonction pour afficher les tirages dans l'interface
async function displayLotteries() {
    const drawsList = document.querySelector('#draws-content .content-body');
    drawsList.innerHTML = '<div class="loading-courses"><div class="spinner"></div><p>Chargement des tirages...</p></div>';

    try {
        const lotteries = await fetchLotteries();

        if (lotteries.length === 0) {
            drawsList.innerHTML = '<div class="no-courses">Aucun tirage disponible pour le moment</div>';
            return;
        }

        drawsList.innerHTML = '';

        lotteries.forEach(lottery => {
            const lotteryCard = createLotteryCard(lottery);
            drawsList.appendChild(lotteryCard);
        });
    } catch (error) {
        drawsList.innerHTML = `<div class="error-loading">Erreur: ${error.message}</div>`;
    }
}

// Fonction pour créer une carte de tirage
function createLotteryCard(lottery) {
    const lotteryCard = document.createElement('div');
    lotteryCard.className = 'content-card';
    lotteryCard.dataset.lotteryId = lottery.lotteryId;

    const drawDate = new Date(lottery.lotteryTime);
    const formattedDate = drawDate.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });

    lotteryCard.innerHTML = `
<div class="content-card-title">${lottery.nomProduit}</div>
<div class="content-card-value">${formattedDate}</div>
<div class="content-card-desc">
<div>Participants: ${lottery.participants || 0}</div>
<div>Coût du ticket: ${lottery.entrieCost}$</div>
<div>Entrées minimum requises: <span style="color: #ffc107; font-weight: bold;">${lottery.minimumEntryNeeded || 'Non spécifié'}</span></div>
</div>
<div class="content-card-actions">
<button class="edit-btn">Modifier</button>
<button class="delete-btn">Supprimer</button>
</div>
`;

    return lotteryCard;
}
document.getElementById('create-lottery-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    const formData = new FormData(this);
    // "buyable" already set to true in the form
    try {
        const response = await fetch('/api/lottery/lotteryData', {
            method: 'POST',
            body: formData,
            headers: {
                'Authorization': `Bearer ${sessionStorage.getItem('accessToken') || localStorage.getItem('accessToken')}`
            }
        });
        if (response.ok) {
            alert('Shop product added!');
            this.reset();
        } else {
            const error = await response.json();
            alert(error.error || 'Error');
        }
    } catch (err) {
        alert('Network error');
    }
});

// Code JavaScript corrigé pour l'ajout de tirage
document.addEventListener('DOMContentLoaded', function() {
    // Variables et éléments
    const addLotteryBtn = document.getElementById('add-lottery-btn');
    const lotteryModal = document.querySelector('.lottery-modal');
    const createLotteryForm = document.getElementById('create-lottery-form');
    const cancelBtn = lotteryModal?.querySelector('.cancel-btn');
    const drawsList = document.querySelector('#draws-content .content-body');
    
    // Fonction pour afficher le modal
    function openLotteryModal() {
        lotteryModal.style.display = 'flex';
        document.body.style.overflow = 'hidden'; // Bloquer le défilement
    }
    
    // Fonction pour fermer le modal
    function closeLotteryModal() {
        lotteryModal.style.display = 'none';
        document.body.style.overflow = 'auto'; // Rétablir le défilement
        resetForm();
    }
    
    // Fonction pour réinitialiser le formulaire
    function resetForm() {
        if (createLotteryForm) {
            createLotteryForm.reset();
        }
    }
    
    // Event Listener pour ouvrir le modal
    if (addLotteryBtn) {
        addLotteryBtn.addEventListener('click', function() {
            openLotteryModal();
        });
    }
    
    // Event Listener pour fermer le modal
    if (cancelBtn) {
        cancelBtn.addEventListener('click', function() {
            closeLotteryModal();
        });
    }
    
    // Fermer le modal en cliquant en dehors
    if (lotteryModal) {
        lotteryModal.addEventListener('click', function(e) {
            if (e.target === lotteryModal) {
                closeLotteryModal();
            }
        });
    }
    
    // Gestion de la soumission du formulaire
    
if (createLotteryForm) {
    createLotteryForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        console.log('Formulaire soumis');
        
        // Création de l'objet FormData
        const formData = new FormData();
        
        // Ajout des champs requis par l'API
        formData.append('nomProduit', document.getElementById('lottery-name').value);
        formData.append('lotteryTime', document.getElementById('lottery-date').value);
        formData.append('entrieCost', document.getElementById('ticket-price').value);
        formData.append('shortDescription', document.getElementById('short-description').value);
        formData.append('fullDescription', document.getElementById('full-description').value);
        // Ajout du nombre minimum d'entrées
        formData.append('minimumEntryNeeded', document.getElementById('minimum-entry-needed').value);
        
        // Ajout de l'image si elle existe
        const imageInput = document.getElementById('imageProduit');
        if (imageInput && imageInput.files[0]) {
            formData.append('imageProduit', imageInput.files[0]);
        }
            
            // Log pour débuggage
            /*for (let [key, value] of formData.entries()) {
            }*/
            
            try {
                // Récupération du token d'authentification
                const accessToken = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken');
                
                
                
                // Envoi de la requête
                const response = await fetch('/api/lottery/lotteryData', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`
                    },
                    body: formData
                });
                
                
                // Vérification de la réponse
                if (!response.ok) {
                    const errorData = await response.json();
                    console.error('Erreur détaillée:', errorData);
                    throw new Error(errorData.error || 'Impossible d\'ajouter le tirage');
                }
                
                // Récupération des données du nouveau tirage
                const newLottery = await response.json();
                
                // Ajout du tirage à l'interface
                addLotteryToUI(newLottery);
                
                // Message de succès
                alert('Tirage ajouté avec succès !');
                
                // Fermeture du modal
                closeLotteryModal();
                
                // Recharger la liste des tirages
                displayLotteries();
                
            } catch (error) {
                console.error('Erreur lors de l\'ajout du tirage:', error);
                alert(error.message);
            }
        });
    }
    
    // Fonction pour ajouter un tirage à l'interface
    function addLotteryToUI(lottery) {
        const drawDate = new Date(lottery.lotteryTime);
        const formattedDate = drawDate.toLocaleDateString('fr-FR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        const lotteryCard = document.createElement('div');
        lotteryCard.className = 'content-card';
        lotteryCard.dataset.lotteryId = lottery.lotteryId;
        lotteryCard.innerHTML = `
            <div class="content-card-title">${lottery.nomProduit}</div>
            <div class="content-card-value">${formattedDate}</div>
            <div class="content-card-desc">
                <div>Participants: ${lottery.participants || 0}</div>
                <div>Coût du ticket: ${lottery.entrieCost}$</div>
            </div>
            <div class="content-card-actions">
                <button class="edit-btn">Modifier</button>
                <button class="delete-btn">Supprimer</button>
                <button class="view-participants-btn">Participants</button>
            </div>
        `;
        
        // Ajout de la carte à la liste
        if (drawsList) {
            drawsList.appendChild(lotteryCard);
            
            // Ajout des listeners pour les boutons
            const deleteBtn = lotteryCard.querySelector('.delete-btn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', async function() {
                    if (confirm(`Êtes-vous sûr de vouloir supprimer le tirage "${lottery.nomProduit}" ?`)) {
                        try {
                            await deleteLottery(lottery.lotteryId);
                            lotteryCard.remove();
                            alert('Tirage supprimé avec succès');
                        } catch (error) {
                            alert(`Erreur: ${error.message}`);
                        }
                    }
                });
            }
        }
    }
    
    // Initialisation au chargement de la page pour la section Tirages
    if (window.location.hash === '#draws-content') {
        displayLotteries();
    }
});




// S'assurer que le HTML du formulaire est correct
function checkAndFixLotteryForm() {
    
    const lotteryModal = document.querySelector('.lottery-modal');
    if (!lotteryModal) {
        console.error('Modal d\'ajout de tirage non trouvé');
        return;
    }
    
    const form = lotteryModal.querySelector('form');
    if (!form) {
        console.error('Formulaire non trouvé dans le modal');
        return;
    }
    
    // S'assurer que le formulaire a l'ID correct
    if (form.id !== 'create-lottery-form') {
        form.id = 'create-lottery-form';
    }
    
    // S'assurer que le formulaire a l'attribut enctype
    if (!form.getAttribute('enctype')) {
        form.setAttribute('enctype', 'multipart/form-data');
    }
    
    // Vérifier les champs obligatoires
    const requiredFields = [
        { name: 'nomProduit', altName: 'lottery-name', label: 'Nom du tirage' },
        { name: 'lotteryTime', altName: 'lottery-date', label: 'Date du tirage' },
        { name: 'entrieCost', altName: 'ticket-price', label: 'Prix du ticket' },
        { name: 'shortDescription', altName: 'short-description', label: 'Description courte' },
        { name: 'fullDescription', altName: 'full-description', label: 'Description complète' },
        { name: 'imageProduit', label: 'Image du tirage' }
    ];
    
    requiredFields.forEach(field => {
        let input = form.querySelector(`[name="${field.name}"]`);
        if (!input && field.altName) {
            input = form.querySelector(`[name="${field.altName}"]`);
        }
        
        if (!input) {
            console.warn(`Champ ${field.label} (${field.name}) non trouvé dans le formulaire`);
        } else if (!input.hasAttribute('required')) {
            input.setAttribute('required', '');
        }
    });
}

// Initialiser l'ajout de tirage au chargement de la page
document.addEventListener('DOMContentLoaded', function() {
    
    // Vérifier et corriger le formulaire
    checkAndFixLotteryForm();
    
    // Initialiser les écouteurs d'événements
    initAddLotteryForm();
    
    // Si on est sur la page des tirages, charger les tirages
    if (window.location.hash === '#draws-content') {
        displayLotteries();
    }
});
    // Gestion du clic sur le menu "Tirages"
    const drawsMenuItem = document.querySelector('.menu-item[data-page="draws"]');
    if (drawsMenuItem) {
        drawsMenuItem.addEventListener('click', displayLotteries);
    }


    
    
    // Délégation d'événement pour les boutons de suppression
    document.querySelector('#draws-content .content-body').addEventListener('click', async function (e) {
        if (e.target.classList.contains('delete-btn')) {
            const card = e.target.closest('.content-card');
            const lotteryId = card.dataset.lotteryId;
            const lotteryName = card.querySelector('.content-card-title').textContent;

            if (confirm(`Êtes-vous sûr de vouloir supprimer le tirage "${lotteryName}" ?`)) {
                try {
                    await deleteLottery(lotteryId);
                    card.remove();
                    alert('Tirage supprimé avec succès');
                } catch (error) {
                    alert(`Erreur: ${error.message}`);
                }
            }
        }
    });


function openEditLotteryModal(lottery) {
    // Vérification que lottery existe et a un id
    if (!lottery || !lottery.lotteryId) {
        console.error('Lottery object is invalid:', lottery);
        alert('Impossible de modifier le tirage : données invalides');
        return;
    }

    // Supprimer l'ancien modal s'il existe
    const existingModal = document.querySelector('.lottery-edit-modal');
    if (existingModal) {
        document.body.removeChild(existingModal);
    }
    
    // Créer un nouveau modal
    const editModal = document.createElement('div');
    editModal.classList.add('lottery-edit-modal');
    editModal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.6);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1000;
    `;
    
    // Contenu du modal avec le nouveau champ minimumEntryNeeded
    editModal.innerHTML = `
        <div class="modal-content" style="
            background-color: #1f2937;
            border-radius: 8px;
            padding: 2rem;
            width: 90%;
            max-width: 600px;
            max-height: 90vh;
            overflow-y: auto;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
            color: #f3f4f6;
        ">
            <h3 style="
                margin-top: 0;
                margin-bottom: 1.5rem;
                font-size: 1.5rem;
                color: #ffc107;
            ">Modifier le tirage</h3>
            
            <form id="edit-lottery-form" enctype="multipart/form-data">
                <input type="hidden" id="edit-lottery-id" name="lotteryId" value="${lottery.lotteryId}">
                
                <div class="form-group" style="margin-bottom: 1.5rem;">
                    <label for="edit-lottery-name" style="
                        display: block;
                        margin-bottom: 0.5rem;
                        font-weight: 500;
                        color: #f3f4f6;
                    ">Nom du tirage</label>
                    <input type="text" id="edit-lottery-name" name="nomProduit" value="${lottery.nomProduit || ''}" required style="
                        width: 100%;
                        padding: 0.75rem;
                        border: 1px solid rgba(255, 255, 255, 0.1);
                        border-radius: 4px;
                        font-size: 1rem;
                        background-color: rgba(0, 0, 0, 0.2);
                        color: #f3f4f6;
                    ">
                </div>
                
                <div class="form-group" style="margin-bottom: 1.5rem;">
                    <label for="edit-lottery-date" style="
                        display: block;
                        margin-bottom: 0.5rem;
                        font-weight: 500;
                        color: #f3f4f6;
                    ">Date du tirage</label>
                    <input type="datetime-local" id="edit-lottery-date" name="lotteryTime" required style="
                        width: 100%;
                        padding: 0.75rem;
                        border: 1px solid rgba(255, 255, 255, 0.1);
                        border-radius: 4px;
                        font-size: 1rem;
                        background-color: rgba(0, 0, 0, 0.2);
                        color: #f3f4f6;
                    ">
                </div>
                
                <div class="form-group" style="margin-bottom: 1.5rem;">
                    <label for="edit-ticket-price" style="
                        display: block;
                        margin-bottom: 0.5rem;
                        font-weight: 500;
                        color: #f3f4f6;
                    ">Prix du ticket</label>
                    <input type="number" id="edit-ticket-price" name="entrieCost" min="1" value="${lottery.entrieCost || ''}" required style="
                        width: 100%;
                        padding: 0.75rem;
                        border: 1px solid rgba(255, 255, 255, 0.1);
                        border-radius: 4px;
                        font-size: 1rem;
                        background-color: rgba(0, 0, 0, 0.2);
                        color: #f3f4f6;
                    ">
                </div>
                
                <!-- Nouveau champ: Minimum Entry Needed -->
                <div class="form-group" style="margin-bottom: 1.5rem;">
                    <label for="edit-minimum-entry-needed" style="
                        display: block;
                        margin-bottom: 0.5rem;
                        font-weight: 500;
                        color: #f3f4f6;
                    ">Nombre minimum de participations</label>
                    <input type="number" id="edit-minimum-entry-needed" name="minimumEntryNeeded" min="1" value="${lottery.minimumEntryNeeded || '10'}" style="
                        width: 100%;
                        padding: 0.75rem;
                        border: 1px solid rgba(255, 255, 255, 0.1);
                        border-radius: 4px;
                        font-size: 1rem;
                        background-color: rgba(0, 0, 0, 0.2);
                        color: #f3f4f6;
                    ">
                    <small style="
                        display: block;
                        font-size: 0.85rem;
                        color: rgba(255, 255, 255, 0.6);
                        margin-top: 0.25rem;
                    ">Nombre minimum d'entrées nécessaires pour que le tirage soit valide</small>
                </div>

                
<div class="form-group" style="margin-bottom: 1.5rem;">
    <label for="edit-product-price" style="
        display: block;
        margin-bottom: 0.5rem;
        font-weight: 500;
        color: #f3f4f6;
    ">Prix réel du produit ($)</label>
    <input type="number" id="edit-product-price" name="price" min="0" step="0.01" value="${lottery.price || ''}" style="
        width: 100%;
        padding: 0.75rem;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 4px;
        font-size: 1rem;
        background-color: rgba(0, 0, 0, 0.2);
        color: #f3f4f6;
    ">
    <small style="
        display: block;
        font-size: 0.85rem;
        color: rgba(255, 255, 255, 0.6);
        margin-top: 0.25rem;
    ">Prix si l'option d'achat direct est activée</small>
</div>

<!-- Nouveau champ: Buyable -->
<div class="form-group" style="margin-bottom: 1.5rem;">
    <label style="
        display: block;
        margin-bottom: 0.5rem;
        font-weight: 500;
        color: #f3f4f6;
    ">Produit achetable directement</label>
    <div style="display: flex; gap: 1rem;">
        <label style="display: flex; align-items: center; cursor: pointer;">
            <input type="radio" id="buyable-yes" name="buyable" value="true" ${lottery.buyable ? 'checked' : ''} style="
                margin-right: 0.5rem;
                cursor: pointer;
            ">
            Oui
        </label>
        <label style="display: flex; align-items: center; cursor: pointer;">
            <input type="radio" id="buyable-no" name="buyable" value="false" ${lottery.buyable === false ? 'checked' : ''} style="
                margin-right: 0.5rem;
                cursor: pointer;
            ">
            Non
        </label>
    </div>
    <small style="
        display: block;
        font-size: 0.85rem;
        color: rgba(255, 255, 255, 0.6);
        margin-top: 0.25rem;
    ">Si activé, les utilisateurs peuvent acheter directement le produit sans participer au tirage</small>
</div>

<!-- Nouveau champ: if_size -->
<div class="form-group" style="margin-bottom: 1.5rem;">
    <label style="
        display: block;
        margin-bottom: 0.5rem;
        font-weight: 500;
        color: #f3f4f6;
    ">Sélection de taille requise</label>
    <div style="display: flex; gap: 1rem;">
        <label style="display: flex; align-items: center; cursor: pointer;">
            <input type="radio" id="if-size-yes" name="if_size" value="true" ${lottery.if_size ? 'checked' : ''} style="
                margin-right: 0.5rem;
                cursor: pointer;
            ">
            Oui
        </label>
        <label style="display: flex; align-items: center; cursor: pointer;">
            <input type="radio" id="if-size-no" name="if_size" value="false" ${lottery.if_size === false ? 'checked' : ''} style="
                margin-right: 0.5rem;
                cursor: pointer;
            ">
            Non
        </label>
    </div>
    <small style="
        display: block;
        font-size: 0.85rem;
        color: rgba(255, 255, 255, 0.6);
        margin-top: 0.25rem;
    ">Si activé, les utilisateurs devront choisir une taille lors de l'achat</small>
</div>
                
                <div class="form-group" style="margin-bottom: 1.5rem;">
                    <label for="edit-short-description" style="
                        display: block;
                        margin-bottom: 0.5rem;
                        font-weight: 500;
                        color: #f3f4f6;
                    ">Description courte</label>
                    <input type="text" id="edit-short-description" name="shortDescription" required style="
                        width: 100%;
                        padding: 0.75rem;
                        border: 1px solid rgba(255, 255, 255, 0.1);
                        border-radius: 4px;
                        font-size: 1rem;
                        background-color: rgba(0, 0, 0, 0.2);
                        color: #f3f4f6;
                    ">
                </div>
                
                <div class="form-group" style="margin-bottom: 1.5rem;">
                    <label for="edit-full-description" style="
                        display: block;
                        margin-bottom: 0.5rem;
                        font-weight: 500;
                        color: #f3f4f6;
                    ">Description complète</label>
                    <textarea id="edit-full-description" name="fullDescription" rows="3" style="
                        width: 100%;
                        padding: 0.75rem;
                        border: 1px solid rgba(255, 255, 255, 0.1);
                        border-radius: 4px;
                        font-size: 1rem;
                        min-height: 100px;
                        resize: vertical;
                        background-color: rgba(0, 0, 0, 0.2);
                        color: #f3f4f6;
                    " required></textarea>
                </div>
                
                <div class="form-group" style="margin-bottom: 1.5rem;">
                    <label for="edit-imageProduit" style="
                        display: block;
                        margin-bottom: 0.5rem;
                        font-weight: 500;
                        color: #f3f4f6;
                    ">Image du tirage</label>
                    <input type="file" id="edit-imageProduit" name="imageProduit" accept="image/*" style="
                        width: 100%;
                        padding: 0.75rem;
                        border: 1px solid rgba(255, 255, 255, 0.1);
                        border-radius: 4px;
                        font-size: 1rem;
                        background-color: rgba(0, 0, 0, 0.2);
                        color: #f3f4f6;
                    ">
                    <small style="
                        display: block;
                        font-size: 0.85rem;
                        color: rgba(255, 255, 255, 0.6);
                        margin-top: 0.25rem;
                    ">Laissez vide pour conserver l'image actuelle</small>
                </div>
                
                <div class="current-image-container" style="
                    margin: 15px 0;
                    padding: 10px;
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 4px;
                    background-color: rgba(0, 0, 0, 0.1);
                ">
                    <p style="margin-top: 0;">Image actuelle:</p>
                    <img id="current-lottery-image" src="${lottery.imageProduit || ''}" alt="Image du tirage" style="max-width: 200px; max-height: 200px;">
                </div>
                
                <div class="form-actions" style="
                    display: flex;
                    justify-content: flex-end;
                    gap: 1rem;
                    margin-top: 2rem;
                ">
                    <button type="button" class="cancel-btn" style="
                        padding: 0.75rem 1.5rem;
                        border-radius: 4px;
                        font-weight: 500;
                        cursor: pointer;
                        transition: all 0.2s;
                        background-color: rgba(255, 255, 255, 0.1);
                        color: #f3f4f6;
                        border: none;
                    ">Annuler</button>
                    <button type="submit" class="submit-btn" style="
                        padding: 0.75rem 1.5rem;
                        border-radius: 4px;
                        font-weight: 500;
                        cursor: pointer;
                        transition: all 0.2s;
                        background-color: #ffc107;
                        color: #111827;
                        border: none;
                    ">Mettre à jour</button>
                </div>
            </form>
        </div>
    `;
    
    // Ajouter le modal au body
    document.body.appendChild(editModal);
    
    // Charger les données complètes du tirage depuis l'API
    fetch(`/api/lottery/lotteryData/${lottery.lotteryId}`, {
        headers: {
            'Authorization': `Bearer ${localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken')}`
        }
    })
    .then(response => response.json())
    .then(result => {
        const lotteryData = result.data || result;
        
        // Remplir le formulaire avec les données complètes
        const form = editModal.querySelector('#edit-lottery-form');
        
        // Si la date existe, la formater pour l'input datetime-local
        if (lotteryData.lotteryTime) {
            const date = new Date(lotteryData.lotteryTime);
            const formattedDate = date.toISOString().slice(0, 16); // Format YYYY-MM-DDThh:mm
            form.querySelector('#edit-lottery-date').value = formattedDate;
        }
        
        // Remplir les autres champs
        form.querySelector('#edit-short-description').value = lotteryData.shortDescription || '';
        form.querySelector('#edit-full-description').value = lotteryData.fullDescription || '';
        
        // Remplir le champ minimumEntryNeeded
        if (lotteryData.minimumEntryNeeded !== undefined) {
            form.querySelector('#edit-minimum-entry-needed').value = lotteryData.minimumEntryNeeded;
        }
        
        // Pour les boutons radio buyable
        if (lotteryData.buyable !== undefined) {
            if (lotteryData.buyable) {
                form.querySelector('#buyable-yes').checked = true;
            } else {
                form.querySelector('#buyable-no').checked = true;
            }
        }
        
        // Pour les boutons radio if_size
        if (lotteryData.if_size !== undefined) {
            if (lotteryData.if_size) {
                form.querySelector('#if-size-yes').checked = true;
            } else {
                form.querySelector('#if-size-no').checked = true;
            }
        }
        
        // Afficher l'image actuelle
        const currentImage = form.querySelector('#current-lottery-image');
        if (lotteryData.imageProduit) {
            currentImage.src = lotteryData.imageProduit;
            currentImage.parentElement.style.display = 'block';
        } else {
            currentImage.parentElement.style.display = 'none';
        }
    })
    .catch(error => {
        console.error('Erreur lors du chargement des données complètes:', error);
    });
    
    // Gérer la fermeture du modal
    const cancelBtn = editModal.querySelector('.cancel-btn');
    cancelBtn.addEventListener('click', () => {
        editModal.remove();
    });
    
    // Fermer en cliquant en dehors
    editModal.addEventListener('click', (e) => {
        if (e.target === editModal) {
            editModal.remove();
        }
    });
    
    // Gérer la soumission du formulaire
    const form = editModal.querySelector('#edit-lottery-form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        // Créer un objet FormData avec les données du formulaire
        const formData = new FormData(form);
        const lotteryId = formData.get('lotteryId');
        
        try {
            // Afficher un indicateur de chargement sur le bouton
            const submitBtn = form.querySelector('.submit-btn');
            const originalBtnText = submitBtn.textContent;
            submitBtn.disabled = true;
            submitBtn.textContent = 'Mise à jour en cours...';

            // Vérifier si l'utilisateur a sélectionné une nouvelle image
            const imageFile = document.getElementById('edit-imageProduit').files[0];
            if (!imageFile) {
                // Si pas de nouvelle image, supprimer le champ du FormData pour éviter les problèmes
                formData.delete('imageProduit');
            }

            // Appel à l'API pour mettre à jour le tirage
            const response = await fetch(`/api/lottery/lotteryData/${lotteryId}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken')}`
                },
                body: formData
            });
            
            if (!response.ok) {
                let errorMessage = 'Erreur lors de la mise à jour';
                let erreurMessage2;
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.error || errorData.message || errorMessage; 
                    erreurMessage2 = errorData.msg;
                } catch (e) {
                    // Si la réponse n'est pas du JSON valide
                    const errorText = await response.text();
                    console.error('Réponse d\'erreur (texte):', errorText);
                }
                console.error('Erreur détaillée:', errorMessage, erreurMessage2);
                throw new Error(errorMessage + (erreurMessage2 ? ' + ' + erreurMessage2 : ''));
            }
            
            // Récupérer les données mises à jour
            const updatedLottery = await response.json();
            
            // Afficher un message de succès
            alert('Tirage mis à jour avec succès!');
            
            // Fermer le modal
            editModal.remove();
            
            // Rafraîchir la liste des tirages
            displayLotteries();
        } catch (error) {
            console.error('Erreur lors de la mise à jour du tirage:', error);
            alert(`Erreur: ${error.message}`);
            
            // Réactiver le bouton de soumission
            const submitBtn = form.querySelector('.submit-btn');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Mettre à jour';
        }
    });
}
// Remplacer la fonction pour ajouter les écouteurs d'événements
function addLotteryCardEventListeners(card) {
    // Bouton Modifier
    card.querySelector('.edit-btn').addEventListener('click', function() {
        const lotteryId = card.dataset.lotteryId;
        const lotteryName = card.querySelector('.content-card-title').textContent;
        const lotteryDate = card.querySelector('.content-card-value').textContent;
        
        // Extraire le coût du ticket - adaptez cela en fonction de votre structure HTML
        const costText = card.querySelector('.content-card-desc').textContent;
        const costMatch = costText.match(/Coût du ticket: (\d+)\$/);
        const entrieCost = costMatch ? costMatch[1] : '';
        
        // Ouvrir le modal d'édition avec les données de base
        openEditLotteryModal({
            lotteryId: lotteryId,
            nomProduit: lotteryName,
            entrieCost: entrieCost
        });
    });
    
    // Bouton Supprimer (conservez votre code existant)
    card.querySelector('.delete-btn').addEventListener('click', async function() {
        const lotteryId = card.dataset.lotteryId;
        const lotteryName = card.querySelector('.content-card-title').textContent;

        if (confirm(`Êtes-vous sûr de vouloir supprimer le tirage "${lotteryName}" ?`)) {
            try {
                await deleteLottery(lotteryId);
                card.remove();
                alert('Tirage supprimé avec succès');
            } catch (error) {
                alert(`Erreur: ${error.message}`);
            }
        }
    });
}

// Mettre à jour la fonction createLotteryCard si nécessaire
const originalCreateLotteryCard = createLotteryCard;
createLotteryCard = function(lottery) {
    const card = originalCreateLotteryCard(lottery);
    
    // Ajouter les écouteurs d'événements directement
    addLotteryCardEventListeners(card);
    
    return card;
};

// Ajouter un écouteur global pour les boutons d'édition (solution alternative)
document.addEventListener('DOMContentLoaded', function() {
    // Écouteur pour les clics dans la liste des tirages (délégation d'événement)
    const drawsContent = document.getElementById('draws-content');
    if (drawsContent) {
        const contentBody = drawsContent.querySelector('.content-body');
        if (contentBody) {
            contentBody.addEventListener('click', function(e) {
                // Si on clique sur un bouton d'édition
                if (e.target.classList.contains('edit-btn')) {
                    const card = e.target.closest('.content-card');
                    if (!card) return;
                    
                    const lotteryId = card.dataset.lotteryId;
                    if (!lotteryId) return;
                    
                    const lotteryName = card.querySelector('.content-card-title').textContent;
                    
                    // Extraire le coût du ticket
                    const costText = card.querySelector('.content-card-desc').textContent;
                    const costMatch = costText.match(/Coût du ticket: (\d+)\$/);
                    const entrieCost = costMatch ? costMatch[1] : '';
                    
                    // Ouvrir le modal d'édition
                    openEditLotteryModal({
                        lotteryId: lotteryId,
                        nomProduit: lotteryName,
                        entrieCost: entrieCost
                    });
                }
            });
        }
    }
});



    // Fonction pour supprimer un tirage
async function deleteLottery(lotteryId) {
    try {
        // Récupération du token d'authentification
        const accessToken = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken');
        
        
        // Appel à l'API pour supprimer le tirage
        const response = await fetch(`/api/lottery/lotteryData/${lotteryId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Erreur lors de la suppression du tirage');
        }

        return true;
    } catch (error) {
        console.error('Erreur lors de la suppression du tirage:', error);
        throw error;
    }
}




document.addEventListener('DOMContentLoaded', function () {
    // Variables pour gérer les lots
    let currentPrizes = [];

    // Fonction pour afficher le modal d'ajout de tirage
    function showAddLotteryModal() {
        const modal = document.querySelector('.lottery-modal');
        modal.style.display = 'flex';
        document.getElementById('prizes-container').innerHTML = ''; // Réinitialiser les lots
        currentPrizes = []; // Réinitialiser le tableau des lots
    }

    // Fonction pour fermer le modal
    function hideAddLotteryModal() {
        document.querySelector('.lottery-modal').style.display = 'none';
    }


    // Gestion du bouton "Ajouter un tirage"
    const addLotteryBtn = document.getElementById('add-lottery-btn');
    if (addLotteryBtn) {
        addLotteryBtn.addEventListener('click', function () {
            document.querySelector('.lottery-modal').style.display = 'flex';
        });
    }



    // Gestion du bouton d'annulation
    document.querySelector('.lottery-modal .cancel-btn').addEventListener('click', hideAddLotteryModal);

    // Fermer le modal en cliquant à l'extérieur
    document.querySelector('.lottery-modal').addEventListener('click', function (e) {
        if (e.target === this) {
            hideAddLotteryModal();
        }
    });

    // Fermeture du modal en cliquant sur le fond ou le bouton annuler
    document.querySelector('.lottery-modal').addEventListener('click', function (e) {
        if (e.target === this || e.target.classList.contains('cancel-btn')) {
            this.style.display = 'none';
        }
    });

    // Fonction pour ajouter un nouveau lot
    document.getElementById('add-prize-btn').addEventListener('click', function () {
        const prizeId = Date.now(); // ID unique pour le lot
        const prizesContainer = document.getElementById('prizes-container');

        const prizeElement = document.createElement('div');
        prizeElement.className = 'prize-item';
        prizeElement.dataset.prizeId = prizeId;
        prizeElement.innerHTML = `
<div class="prize-form">
<div class="form-group">
    <label>Description du lot</label>
    <input type="text" class="prize-description" required>
</div>
<div class="form-group">
    <label>Valeur ($)</label>
    <input type="number" class="prize-value" min="1" required>
</div>
<div class="form-group">
    <label>Quantité disponible</label>
    <input type="number" class="prize-quantity" min="1" value="1" required>
</div>
<button type="button" class="remove-prize-btn">Supprimer</button>
</div>
`;

        prizesContainer.appendChild(prizeElement);

        // Gestion de la suppression d'un lot
        prizeElement.querySelector('.remove-prize-btn').addEventListener('click', function () {
            prizeElement.remove();
            currentPrizes = currentPrizes.filter(prize => prize.id !== prizeId);
        });
    });

    // Soumission du formulaire de création de tirage
    document.getElementById('create-lottery-form').addEventListener('submit', async function (e) {
        e.preventDefault();

        // Récupérer les données du formulaire
        const lotteryName = document.getElementById('lottery-name').value;
        const lotteryDate = document.getElementById('lottery-date').value;
        const ticketPrice = document.getElementById('ticket-price').value;

        // Récupérer les lots
        const prizeItems = document.querySelectorAll('.prize-item');
        const prizes = [];

        prizeItems.forEach(item => {
            prizes.push({
                description: item.querySelector('.prize-description').value,
                value: parseFloat(item.querySelector('.prize-value').value),
                quantity: parseInt(item.querySelector('.prize-quantity').value)
            });
        });

        // Validation des données
        if (!lotteryName || !lotteryDate || !ticketPrice) {
            alert('Veuillez remplir tous les champs obligatoires');
            return;
        }

        if (prizes.length === 0) {
            alert('Veuillez ajouter au moins un lot');
            return;
        }

        // Créer l'objet tirage à envoyer à l'API
        const lotteryData = {
            name: lotteryName,
            drawDate: lotteryDate,
            ticketPrice: parseFloat(ticketPrice),
            prizes: prizes
        };

        try {
            // Ici, vous feriez normalement un appel à votre API
            // Par exemple:
            // const response = await fetch('/api/lotteries', {
            //     method: 'POST',
            //     headers: {
            //         'Content-Type': 'application/json',
            //         'Authorization': 'Bearer ' + localStorage.getItem('token')
            //     },
            //     body: JSON.stringify(lotteryData)
            // });

            // Pour l'exemple, nous allons simuler une réponse réussie

            // Simuler un délai de requête
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Ajouter le nouveau tirage à l'interface (simulation)
            addLotteryToUI({
                id: Date.now(),
                ...lotteryData,
                status: 'planned',
                participants: 0
            });

            // Afficher un message de succès
            alert('Tirage créé avec succès!');

            // Fermer le modal
            hideAddLotteryModal();

            // Réinitialiser le formulaire
            this.reset();

        } catch (error) {
            console.error('Erreur lors de la création du tirage:', error);
            alert('Une erreur est survenue lors de la création du tirage');
        }
    });

    

   // Fonction pour ajouter un tirage à l'interface
function addLotteryToUI(lottery) {
    const drawDate = new Date(lottery.lotteryTime);
    const formattedDate = drawDate.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    
    const lotteryCard = document.createElement('div');
    lotteryCard.className = 'content-card';
    lotteryCard.dataset.lotteryId = lottery.lotteryId;
    lotteryCard.innerHTML = `
        <div class="content-card-title">${lottery.nomProduit}</div>
        <div class="content-card-value">${formattedDate}</div>
        <div class="content-card-desc">
            <div>Participants: ${lottery.participants || 0}</div>
            <div>Coût du ticket: ${lottery.entrieCost}$</div>
            <div>Entrées minimum requises: <span style="color: #ffc107; font-weight: bold;">${lottery.minimumEntryNeeded || 'Non spécifié'}</span></div>
        </div>
        <div class="content-card-actions">
            <button class="edit-btn">Modifier</button>
            <button class="delete-btn">Supprimer</button>
            <button class="view-participants-btn">Participants</button>
        </div>
    `;

        // Ajouter la carte à la liste des tirages
        document.querySelector('#draws-content .content-body').appendChild(lotteryCard);

        // Ajouter les écouteurs d'événements pour les boutons
        addLotteryCardEventListeners(lotteryCard);
    }

    // Fonction pour ajouter les écouteurs d'événements à une carte de tirage
    function addLotteryCardEventListeners(card) {
        // Bouton Modifier
        card.querySelector('.edit-btn').addEventListener('click', function () {
            const lotteryId = card.dataset.lotteryId;
            alert(`Fonctionnalité de modification pour le tirage ${lotteryId} à implémenter`);
        });
        

        // Bouton Supprimer
        card.querySelector('.delete-btn').addEventListener('click', async function () {
            const lotteryId = card.dataset.lotteryId;
            const lotteryName = card.querySelector('.content-card-title').textContent;

            if (confirm(`Êtes-vous sûr de vouloir supprimer le tirage "${lotteryName}" ?`)) {
                try {
                    // Ici, vous feriez normalement un appel à votre API pour supprimer
                    // await fetch(`/api/lotteries/${lotteryId}`, { method: 'DELETE' });

                    // Simuler un délai de suppression
                    await new Promise(resolve => setTimeout(resolve, 500));

                    // Supprimer la carte de l'interface
                    card.remove();
                    alert('Tirage supprimé avec succès');
                } catch (error) {
                    console.error('Erreur lors de la suppression:', error);
                    alert('Une erreur est survenue lors de la suppression');
                }
            }
        });
    }
    document.head.appendChild(style);
});









// Cours

// Fonction pour récupérer les cours depuis l'API
async function fetchCourses() {
    try {
        const response = await fetch('/api/course/all-courses', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
            }
        });
        if (!response.ok) {
            throw new Error('Erreur lors du chargement des cours');
        }
        return await response.json();
    } catch (error) {
        console.error('Erreur:', error);
        return [];
    }
}

async function displayCourses() {
    const coursesList = document.getElementById('courses-list');
    coursesList.innerHTML = '<div class="loading-courses"><div class="spinner"></div><p>Chargement des cours...</p></div>';

    try {
        const courses = await fetchCourses();

        if (courses.length === 0) {
            coursesList.innerHTML = '<div class="no-courses">Aucun cours disponible pour le moment</div>';
            return;
        }

        coursesList.innerHTML = '';

        courses.forEach(course => {
            const courseCard = document.createElement('div');
            courseCard.className = 'content-card';
            courseCard.dataset.courseId = course.id;
            
            // Vérifier si le cours a une image et l'afficher
            const courseImage = course.image_url 
                ? `<div class="card-image"><img src="${course.image_url}" alt="${course.nom}"></div>` 
                : `<div class="card-image"><div class="default-image">📚</div></div>`;
            
            courseCard.innerHTML = `
                ${courseImage}
                <div class="content-card-title">${course.nom}</div>
                <div class="content-card-value">${course.students || 0} étudiants</div>
                <div class="content-card-desc">${course.description || ''}</div>
                <div class="content-card-actions">
                    <button class="edit-course-btn" style="
                        background-color: #3490dc; 
                        color: white; 
                        border: none; 
                        padding: 6px 12px; 
                        border-radius: 4px; 
                        cursor: pointer;
                        margin-right: 8px;
                    ">Modifier</button>
                    <button class="delete-btn">Supprimer</button>
                </div>
            `;
            coursesList.appendChild(courseCard);
        
            // Ajouter l'événement pour éditer
            const editBtn = courseCard.querySelector('.edit-course-btn');
            editBtn.addEventListener('click', () => {
                openCourseEditModal(course);
            });
        });
        
        // Attacher les écouteurs pour les boutons de suppression
        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                const card = this.closest('.content-card');
                if (!card) return;
                
                const courseId = card.dataset.courseId;
                if (!courseId) return;
                
                deleteCourse(courseId);
            });
        });

    } catch (error) {
        coursesList.innerHTML = `<div class="error-loading">Erreur: ${error.message}</div>`;
    }
}

// Fonction pour gérer la modification d'un cours
/*
async function handleEditCourse(courseId, formData) {
    try {
        const response = await fetch(`/api/course/update/${courseId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
            },
            body: formData
        });

        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const errorText = await response.text();
            throw new Error(`Réponse serveur invalide: ${errorText.substring(0, 100)}...`);
        }

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Erreur lors de la modification');
        }

        return result;
    } catch (error) {
        console.error('Erreur handleEditCourse:', error);
        throw error;
    }
}*/

function openCourseEditModal(course) {
    // Vérification que course existe et a un id
    if (!course || !course.id) {
        console.error('Course object is invalid:', course);
        alert('Impossible de modifier le cours : données invalides');
        return;
    }

    // Supprimer l'ancien modal s'il existe
    const existingModal = document.querySelector('.course-edit-modal');
    if (existingModal) {
        document.body.removeChild(existingModal);
    }
    
    // Créer un nouveau modal
    const editModal = document.createElement('div');
    editModal.classList.add('course-edit-modal');
    editModal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.6);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1000;
    `;
    
    // Contenu du modal avec la section de fichiers
    editModal.innerHTML = `
        <div class="modal-content" style="
            background-color: #1f2937;
            border-radius: 8px;
            padding: 2rem;
            width: 90%;
            max-width: 600px;
            max-height: 90vh;
            overflow-y: auto;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
            color: #f3f4f6;
        ">
            <h3 style="
                margin-top: 0;
                margin-bottom: 1.5rem;
                font-size: 1.5rem;
                color: #ffc107;
            ">Modifier le cours</h3>
            
            <form id="edit-course-form" enctype="multipart/form-data">
                <input type="hidden" id="edit-course-id" name="id" value="${course.id}">
                
                <div class="form-group" style="margin-bottom: 1.5rem;">
                    <label for="edit-course-title" style="
                        display: block;
                        margin-bottom: 0.5rem;
                        font-weight: 500;
                        color: #f3f4f6;
                    ">Titre du cours</label>
                    <input type="text" id="edit-course-title" name="nom" value="${course.nom || ''}" required style="
                        width: 100%;
                        padding: 0.75rem;
                        border: 1px solid rgba(255, 255, 255, 0.1);
                        border-radius: 4px;
                        font-size: 1rem;
                        background-color: rgba(0, 0, 0, 0.2);
                        color: #f3f4f6;
                    ">
                </div>
                
                <div class="form-group" style="margin-bottom: 1.5rem;">
                    <label for="edit-course-description" style="
                        display: block;
                        margin-bottom: 0.5rem;
                        font-weight: 500;
                        color: #f3f4f6;
                    ">Description</label>
                    <textarea id="edit-course-description" name="description" rows="3" style="
                        width: 100%;
                        padding: 0.75rem;
                        border: 1px solid rgba(255, 255, 255, 0.1);
                        border-radius: 4px;
                        font-size: 1rem;
                        min-height: 100px;
                        resize: vertical;
                        background-color: rgba(0, 0, 0, 0.2);
                        color: #f3f4f6;
                    ">${course.description || ''}</textarea>
                </div>
                
                <div class="form-group" style="margin-bottom: 1.5rem;">
                    <label for="edit-course-niveau" style="
                        display: block;
                        margin-bottom: 0.5rem;
                        font-weight: 500;
                        color: #f3f4f6;
                    ">Niveau</label>
                    <select id="edit-course-niveau" name="niveau" required style="
                        width: 100%;
                        padding: 0.75rem;
                        border: 1px solid rgba(255, 255, 255, 0.1);
                        border-radius: 4px;
                        font-size: 1rem;
                        background-color: rgba(0, 0, 0, 0.2);
                        color: #f3f4f6;
                    ">
                        <option value="débutant" ${(course.niveau === 'débutant') ? 'selected' : ''}>Débutant</option>
                        <option value="intermédiaire" ${(course.niveau === 'intermédiaire') ? 'selected' : ''}>Intermédiaire</option>
                        <option value="avancé" ${(course.niveau === 'avancé') ? 'selected' : ''}>Avancé</option>
                    </select>
                </div>
                
                <div class="form-group" style="margin-bottom: 1.5rem;">
                    <label for="edit-course-heures" style="
                        display: block;
                        margin-bottom: 0.5rem;
                        font-weight: 500;
                        color: #f3f4f6;
                    ">Nombre d'heures</label>
                    <input type="number" id="edit-course-heures" name="nombre_heures" min="1" max="500" value="${course.nombre_heures || ''}" required style="
                        width: 100%;
                        padding: 0.75rem;
                        border: 1px solid rgba(255, 255, 255, 0.1);
                        border-radius: 4px;
                        font-size: 1rem;
                        background-color: rgba(0, 0, 0, 0.2);
                        color: #f3f4f6;
                    ">
                </div>
                
                <div class="form-group" style="margin-bottom: 1.5rem;">
                    <label for="edit-course-prix" style="
                        display: block;
                        margin-bottom: 0.5rem;
                        font-weight: 500;
                        color: #f3f4f6;
                    ">Prix ($)</label>
                    <input type="number" id="edit-course-prix" name="prix" step="0.01" min="0" value="${course.prix || 0}" style="
                        width: 100%;
                        padding: 0.75rem;
                        border: 1px solid rgba(255, 255, 255, 0.1);
                        border-radius: 4px;
                        font-size: 1rem;
                        background-color: rgba(0, 0, 0, 0.2);
                        color: #f3f4f6;
                    ">
                </div>

                <div class="form-group" style="margin-bottom: 1.5rem;">
    <label for="edit-course-image" style="
        display: block;
        margin-bottom: 0.5rem;
        font-weight: 500;
        color: #f3f4f6;
    ">Image du cours</label>
    
    ${course.image_url ? `
    <div style="
        margin-bottom: 10px;
        padding: 5px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 4px;
        background-color: rgba(0, 0, 0, 0.1);
    ">
        <p style="margin: 0 0 5px 0; font-size: 0.9rem;">Image actuelle:</p>
        <img src="${course.image_url}" alt="${course.nom}" style="max-width: 100%; max-height: 150px; display: block; margin: 0 auto;">
    </div>
    ` : ''}
    
    <input type="file" id="edit-course-image" name="courseImage" accept="image/*" style="
        width: 100%;
        padding: 10px;
        border: 2px dashed rgba(255, 193, 7, 0.3);
        border-radius: 4px;
        background-color: rgba(0, 0, 0, 0.2);
        color: #f3f4f6;
    ">
    <small style="
        display: block;
        font-size: 0.85rem;
        color: rgba(255, 255, 255, 0.6);
        margin-top: 0.25rem;
    ">Format recommandé: 16:9, minimum 600×338 pixels. Laissez vide pour conserver l'image actuelle.</small>
</div>

                
                <div class="form-group" style="
                    margin-bottom: 1.5rem; 
                    border-top: 1px solid rgba(255, 255, 255, 0.1); 
                    padding-top: 1.5rem;
                ">
                    <label style="
                        display: block;
                        margin-bottom: 0.5rem;
                        font-weight: 600;
                        color: #ffc107;
                        font-size: 1.1rem;
                    ">Fichiers du cours</label>
                    
                    <div id="current-files-container" style="
                        margin-bottom: 15px;
                        padding: 10px;
                        border: 1px solid rgba(255, 255, 255, 0.1);
                        border-radius: 4px;
                        background-color: rgba(0, 0, 0, 0.2);
                    ">
                        <p style="margin-top: 0; margin-bottom: 10px; color: #f3f4f6;">Fichiers actuels:</p>
                        <div id="lessons-list" style="max-height: 200px; overflow-y: auto;">
                            ${displayExistingLessons(course.lessons || [])}
                        </div>
                    </div>
                    
                    <label for="files" style="
                        display: block;
                        margin-bottom: 0.5rem;
                        margin-top: 1rem;
                        font-weight: 500;
                        color: #f3f4f6;
                    ">Ajouter un nouveau fichier</label>
                    <input type="file" id="files" name="files" style="
                        width: 100%;
                        padding: 10px;
                        border: 2px dashed rgba(255, 193, 7, 0.3);
                        border-radius: 4px;
                        font-size: 1rem;
                        background-color: rgba(0, 0, 0, 0.2);
                        color: #f3f4f6;
                        cursor: pointer;
                    ">
                    <small style="display: block; color: rgba(255, 255, 255, 0.5); margin-top: 5px;">
                        Formats acceptés: MP4, PDF, ZIP (max 50MB)
                    </small>
                </div>
                
                <div class="form-actions" style="
                    display: flex;
                    justify-content: flex-end;
                    gap: 1rem;
                    margin-top: 2rem;
                ">
                    <button type="button" class="course-cancel-btn" style="
                        padding: 0.75rem 1.5rem;
                        border-radius: 4px;
                        font-weight: 500;
                        cursor: pointer;
                        transition: all 0.2s;
                        background-color: rgba(255, 255, 255, 0.1);
                        color: #f3f4f6;
                        border: none;
                    ">Annuler</button>
                    <button type="submit" class="submit-btn" style="
                        padding: 0.75rem 1.5rem;
                        border-radius: 4px;
                        font-weight: 500;
                        cursor: pointer;
                        transition: all 0.2s;
                        background-color: #ffc107;
                        color: #111827;
                        border: none;
                    ">Mettre à jour</button>
                </div>
            </form>
        </div>
    `;
    
    // Ajouter le modal au body
    document.body.appendChild(editModal);
    
    // Gérer la fermeture du modal
    const cancelBtn = editModal.querySelector('.course-cancel-btn');
    cancelBtn.addEventListener('click', () => {
        editModal.remove();
    });
    
    // Fermer en cliquant en dehors
    editModal.addEventListener('click', (e) => {
        if (e.target === editModal) {
            editModal.remove();
        }
    });
    
    // Gérer la soumission du formulaire
    const form = editModal.querySelector('#edit-course-form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        // Créer un FormData pour pouvoir envoyer des fichiers
        const formData = new FormData(form);
        const courseId = formData.get('id');
        
        // IMPORTANT: Supprimer l'ID du FormData avant l'envoi
        formData.delete('id');
        
        // Afficher un indicateur de chargement
        const submitBtn = form.querySelector('.submit-btn');
        const originalBtnText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Mise à jour en cours...';
        submitBtn.style.backgroundColor = 'rgba(255, 193, 7, 0.7)';
        
        try {
            // Ajouter des logs pour déboguer
            
            // Vérifier si un fichier est sélectionné - Correction de la référence
            const fileInput = form.querySelector('input[type="file"]');
            if (fileInput && fileInput.files && fileInput.files.length > 0) {
            } else {
            }
            
            // Envoyer les données au serveur en utilisant l'ID dans l'URL uniquement
            const response = await fetch(`/api/course/update/${courseId}`, {
                method: 'PUT',
                body: formData,
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken')}`
                }
            });
            
            if (response.ok) {
                // Traiter la réponse
                const updatedCourse = await response.json();
                alert('Cours mis à jour avec succès!');
                editModal.remove();
                
                // Rafraîchir la liste des cours
                displayCourses();
            } else {
                // Gérer les erreurs
                try {
                    const errorData = await response.json();
                    console.error('Erreur détaillée:', errorData);
                    alert(`Erreur: ${errorData.error || errorData.message || 'Impossible de mettre à jour le cours'}`);
                } catch (jsonError) {
                    // Si la réponse n'est pas du JSON valide
                    console.error('Erreur lors de la mise à jour:', await response.text());
                    alert(`Erreur: Le serveur a retourné une réponse non valide (${response.status})`);
                }
            }
        } catch (error) {
            console.error('Erreur lors de la mise à jour du cours:', error);
            alert('Une erreur est survenue lors de la mise à jour du cours');
        } finally {
            // Réactiver le bouton de soumission
            submitBtn.disabled = false;
            submitBtn.textContent = originalBtnText;
            submitBtn.style.backgroundColor = '#ffc107';
        }
    });
}

// Fonction pour afficher les leçons existantes
function displayExistingLessons(lessons) {
    if (!lessons || lessons.length === 0) {
        return '<p style="color: rgba(255, 255, 255, 0.5); font-style: italic; text-align: center; padding: 10px;">Aucun fichier disponible pour ce cours</p>';
    }
    
    let lessonsHTML = '<ul style="list-style: none; padding: 0; margin: 0;">';
    
    lessons.forEach((lesson, index) => {
        // Déterminer l'icône en fonction du type de fichier
        let icon = '📄'; // Icône par défaut
        
        if (lesson.type === 'video') {
            icon = '🎬';
        } else if (lesson.type === 'pdf') {
            icon = '📕';
        } else if (lesson.type === 'txt') {
            icon = '📝';
        } else if (lesson.type === 'png' || lesson.type.includes('image')) {
            icon = '🖼️';
        } else if (lesson.type === 'zip' || lesson.type === 'rar') {
            icon = '📦';
        }
        
        // Extraire le nom du fichier de l'URL
        const fileName = lesson.title || (lesson.url ? lesson.url.split('/').pop() : `Fichier ${index + 1}`);
        
        lessonsHTML += `
            <li style="
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 8px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.05);
                background-color: rgba(0, 0, 0, 0.1);
                margin-bottom: 5px;
                border-radius: 4px;
            ">
                <div style="display: flex; align-items: center; overflow: hidden;">
                    <span style="font-size: 1.5rem; margin-right: 10px; flex-shrink: 0;">${icon}</span>
                    <div style="overflow: hidden; text-overflow: ellipsis;">
                        <span style="display: block; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${fileName}</span>
                        <small style="color: rgba(255, 255, 255, 0.5);">${lesson.type}</small>
                    </div>
                </div>
                ${lesson.url ? `
                <div style="display: flex; gap: 5px;">
                    <a href="${lesson.url}" target="_blank" style="
                        background-color: rgba(79, 70, 229, 0.8);
                        color: white;
                        border: none;
                        border-radius: 4px;
                        padding: 4px 8px;
                        cursor: pointer;
                        text-decoration: none;
                        font-size: 0.8rem;
                        display: flex;
                        align-items: center;
                    ">
                        <span style="margin-right: 3px;">👁️</span> Voir
                    </a>
                </div>
                ` : ''}
            </li>
        `;
    });
    
    lessonsHTML += '</ul>';
    return lessonsHTML;
}

// Styles CSS pour l'affichage des images de cours
const coursesImageStyles = document.createElement('style');
coursesImageStyles.textContent = `
    .card-image {
        width: 100%;
        height: 150px;
        margin: 10px 0;
        overflow: hidden;
        border-radius: 8px;
        display: flex;
        justify-content: center;
        align-items: center;
    }
    .card-image img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        transition: transform 0.3s ease;
    }
    .card-image:hover img {
        transform: scale(1.05);
    }
    .default-image {
        background-color: rgba(0, 0, 0, 0.1);
        color: rgba(255, 255, 255, 0.7);
        font-size: 40px;
        display: flex;
        justify-content: center;
        align-items: center;
    }
    .content-card-value {
        margin-bottom: 10px;
        color: #ffc107;
        font-weight: bold;
    }
`;
document.head.appendChild(coursesImageStyles);

// Fonction d'affichage des cours avec images
async function displayCourses() {
    const coursesList = document.getElementById('courses-list');
    coursesList.innerHTML = '<div class="loading-courses"><div class="spinner"></div><p>Chargement des cours...</p></div>';
    try {
        const courses = await fetchCourses();
        if (courses.length === 0) {
            coursesList.innerHTML = '<div class="no-courses">Aucun cours disponible pour le moment</div>';
            return;
        }
        coursesList.innerHTML = '';
        courses.forEach(course => {
            const courseCard = document.createElement('div');
            courseCard.className = 'content-card';
            courseCard.dataset.courseId = course.id;
            
            // Préparer l'élément d'image du cours
            const courseImageHtml = course.image_url 
                ? `<div class="card-image"><img src="${course.image_url}" alt="${course.nom}"></div>` 
                : `<div class="card-image default-image">📚</div>`;
            
            courseCard.innerHTML = `
                <div class="content-card-title">${course.nom}</div>
                <div class="content-card-value">${course.students || 0} étudiants</div>
                ${courseImageHtml}
                <div class="content-card-desc">${course.description || ''}</div>
                <div class="content-card-actions">
                    <button class="edit-course-btn" style="
                        background-color: #3490dc; 
                        color: white; 
                        border: none; 
                        padding: 6px 12px; 
                        border-radius: 4px; 
                        cursor: pointer;
                        margin-right: 8px;
                    ">Modifier</button>
                    <button class="delete-btn">Supprimer</button>
                </div>
            `;
            
            coursesList.appendChild(courseCard);
            
            // Ajouter l'événement pour éditer
            const editBtn = courseCard.querySelector('.edit-course-btn');
            editBtn.addEventListener('click', () => {
                openCourseEditModal(course);
            });
        });
        
        // Attacher les écouteurs pour les boutons de suppression
        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                const card = this.closest('.content-card');
                if (!card) return;
                
                const courseId = card.dataset.courseId;
                if (!courseId) return;
                
                deleteCourse(courseId);
            });
        });
    } catch (error) {
        coursesList.innerHTML = `<div class="error-loading">Erreur: ${error.message}</div>`;
    }
}
async function deleteCourse(courseId) {
    // Demander confirmation avant de supprimer
    if (!confirm('Êtes-vous sûr de vouloir supprimer ce cours ?')) return false;
    
    try {
        // Ajout simple d'un effet visuel sur la carte
        const courseCard = document.querySelector(`.content-card[data-course-id="${courseId}"]`);
        if (courseCard) {
            courseCard.style.opacity = '0.5'; // Assombrir la carte pendant la suppression
        }
        
        // Récupérer les tokens d'authentification
        const accessToken = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken');
        
        // Vérifier si un token existe
       
                
        // Vérifier la forme du token
       
        
        // Envoi de la requête avec le token dans les en-têtes
        const response = await fetch(`/api/course/${courseId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            // Animation simple de disparition et suppression de l'élément DOM
            if (courseCard) {
                courseCard.style.opacity = '0';
                courseCard.style.height = '0';
                courseCard.style.margin = '0';
                courseCard.style.overflow = 'hidden';
                
                setTimeout(() => {
                    courseCard.remove();
                    // Vérifier s'il reste des cours
                    const coursesList = document.getElementById('courses-list');
                    if (coursesList && coursesList.children.length === 0) {
                        coursesList.innerHTML = '<div class="no-courses">Aucun cours disponible pour le moment</div>';
                    }
                }, 300);
            }
            
            alert('Cours supprimé avec succès');
            return true;
        } else {
            // En cas d'erreur, restaurer l'opacité
            if (courseCard) {
                courseCard.style.opacity = '1';
            }
            
            // Traiter les différentes réponses d'erreur
            if (response.status === 401 || response.status === 403) {
                throw new Error('Vous n\'avez pas les droits requis pour supprimer ce cours. Cette action nécessite des privilèges d\'administrateur.');
            } else {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Erreur lors de la suppression');
            }
        }
    } catch (error) {
        console.error('Erreur:', error);
        
        // Restaurer l'opacité en cas d'erreur
        const courseCard = document.querySelector(`.content-card[data-course-id="${courseId}"]`);
        if (courseCard) {
            courseCard.style.opacity = '1';
        }
        
        alert(`Échec de la suppression: ${error.message}`);
        return false;
    }
}
// Fonction de gestion des clics pour la suppression
function handleDeleteClick(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const card = this.closest('.content-card');
    if (!card) {
        console.error("Impossible de trouver la carte parente");
        return;
    }
    
    const courseId = card.dataset.courseId;
    if (!courseId) {
        console.error("Attribut data-course-id manquant");
        return;
    }
    
    deleteCourse(courseId);
}

// Modification pour s'assurer que displayCourses réattache les écouteurs
const originalDisplayCourses = displayCourses;
displayCourses = async function() {
    await originalDisplayCourses();
    
    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.removeEventListener('click', handleDeleteClick);
        btn.addEventListener('click', handleDeleteClick);
    });
};

// Ajouter les écouteurs d'événements aux boutons de suppression
document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', async function () {
            const card = this.closest('.content-card');
            const courseId = card.dataset.courseId;

            const success = await deleteCourse(courseId);
            if (success) {
                card.remove(); // Supprime la carte de l'interface si la suppression API a réussi
            }
        });
    });
});


// Fonction pour afficher une page spécifique
function showPage(pageName) {
    // Cacher toutes les pages
    pageContents.forEach(content => {
        content.classList.remove('active');
    });

    // Afficher la page demandée
    const pageToShow = document.getElementById(`${pageName}-content`);
    if (pageToShow) {
        pageToShow.classList.add('active');

        // Charger les données si c'est la page des cours
        if (pageName === 'courses') {
            displayCourses();
        }
    } else {
        // Si la page n'existe pas, afficher le dashboard par défaut
        document.getElementById('dashboard-content').classList.add('active');
    }
}

// Gérer les clics sur les éléments du menu
menuItems.forEach(item => {
    item.addEventListener('click', function () {
        // Supprimer la classe active de tous les éléments
        menuItems.forEach(menuItem => {
            menuItem.classList.remove('active');
        });

        // Ajouter la classe active à l'élément cliqué
        this.classList.add('active');

        // Mettre à jour le titre de la page
        const pageName = this.getAttribute('data-page');
        if (pageName) {
            // Capitaliser le premier caractère et mettre à jour le titre
            const formattedPageName = pageName.charAt(0).toUpperCase() + pageName.slice(1);
            pageTitle.textContent = formattedPageName.replace(/-/g, ' ');

            // Afficher la page correspondante
            showPage(pageName);
        }
    });
});

// Gérer les sous-menus
menuItemsWithSubmenu.forEach(item => {
    item.addEventListener('click', function (e) {
        // Obtenir le sous-menu de cet élément
        const submenu = this.querySelector('.submenu');

        // Vérifier si on a cliqué sur le sous-menu lui-même
        if (e.target.closest('.submenu')) {
            // Si c'est le cas, ne pas toggle le sous-menu
            return;
        }

        // Toggle la classe 'open' sur le sous-menu
        submenu.classList.toggle('open');

        // Empêcher la propagation de l'événement pour éviter que le menu parent soit également traité
        e.stopPropagation();
    });
});


document.addEventListener('DOMContentLoaded', function() {
    // Sélectionner les éléments
    const pageTitle = document.querySelector('.page-title'); // Assurez-vous que cette classe existe
    const adminBtn = document.getElementById('adminBtn'); // Assurez-vous que cet ID existe
    const adminModal = document.getElementById('adminModal'); // Assurez-vous que cet ID existe
    const closeModal = document.getElementById('closeModal'); // Assurez-vous que cet ID existe
    
    // Définir la fonction showPage si nécessaire
    function showPage(pageName) {
        // Votre code pour afficher la page
    }

    // Vérifier si les éléments existent
    if (pageTitle && adminBtn && adminModal && closeModal) {
        // Votre code ici, maintenant que vous savez que les éléments existent
        
        // Gérer les clics sur les éléments du sous-menu
        document.querySelectorAll('.submenu-item').forEach(item => {
            item.addEventListener('click', function(e) {
                // Votre code
            });
        });
        
        // Etc.
    } else {
        console.error("Certains éléments nécessaires sont manquants dans le DOM");
        // Vous pouvez ajouter des détails sur lesquels manquent
        if (!pageTitle) console.error("pageTitle est manquant");
        if (!adminBtn) console.error("adminBtn est manquant");
        if (!adminModal) console.error("adminModal est manquant");
        if (!closeModal) console.error("closeModal est manquant");
    }
});

// Fermer le modal en cliquant en dehors
window.addEventListener('click', function (event) {
    if (event.target === adminModal) {
        const modalContent = adminModal.querySelector('.modal-content');
        modalContent.style.transform = 'translateY(20px)';

        setTimeout(() => {
            adminModal.style.display = 'none';
        }, 300);
    }
});

// Gérer les clics sur les options d'administration
document.querySelectorAll('.admin-option').forEach(option => {
    option.addEventListener('click', function () {
        // Animation de clic
        this.style.transform = 'scale(0.95)';
        setTimeout(() => {
            this.style.transform = 'scale(1)';
        }, 100);

        // Afficher un message de confirmation
        alert(`Option sélectionnée : ${this.querySelector('.admin-option-title').textContent}`);
    });
});

// Recherche interactive
const searchInput = document.querySelector('.search-input');
searchInput.addEventListener('input', function () {
    const searchTerm = this.value.toLowerCase();

    // Filtrer les éléments du menu
    menuItems.forEach(item => {
        const menuText = item.querySelector('.menu-text');
        if (menuText) {
            const text = menuText.textContent.toLowerCase();
            if (text.includes(searchTerm) || searchTerm === '') {
                item.style.display = 'flex';
            } else {
                item.style.display = 'none';
            }
        }
    });
});

// Animation des badges de notification
const badges = document.querySelectorAll('.notification-badge');
badges.forEach(badge => {
    // Animation légère des badges
    setInterval(() => {
        badge.style.transform = 'scale(1.1)';
        setTimeout(() => {
            badge.style.transform = 'scale(1)';
        }, 200);
    }, 3000);
});

// Mise à jour en temps réel des métriques (simulation)
function updateMetrics() {
    const metricValues = document.querySelectorAll('.metric-value');
    metricValues.forEach(value => {
        let currentValue = value.textContent;

        // Traiter les valeurs monétaires
        if (currentValue.includes('$')) {
            const numericValue = parseFloat(currentValue.replace('$', '').replace('K', ''));
            const randomChange = (Math.random() * 2 - 1) * 0.5; // Valeur entre -0.5 et +0.5
            const newValue = (numericValue + randomChange).toFixed(1);
            value.textContent = `$${newValue}K`;
        }
        // Traiter les pourcentages
        else if (currentValue.includes('%')) {
            const numericValue = parseFloat(currentValue.replace('%', ''));
            const randomChange = (Math.random() * 2 - 1) * 0.3; // Valeur entre -0.3 et +0.3
            const newValue = (numericValue + randomChange).toFixed(1);
            value.textContent = `${newValue}%`;
        }
    });
}

// Mettre à jour les métriques toutes les 10 secondes
setInterval(updateMetrics, 10000);

// Animation d'entrée
document.addEventListener('DOMContentLoaded', function () {
    // Animer l'entrée des cartes du dashboard avec un effet de cascade
    const dashboardCards = document.querySelectorAll('.dashboard-card');
    dashboardCards.forEach((card, index) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(20px)';
        card.style.transition = 'opacity 0.5s ease, transform 0.5s ease';

        setTimeout(() => {
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
        }, 100 * index);
    });

    // Animer l'entrée de la section de bienvenue
    const welcomeSection = document.querySelector('.welcome-section');
    welcomeSection.style.opacity = '0';
    welcomeSection.style.transform = 'translateY(20px)';
    welcomeSection.style.transition = 'opacity 0.5s ease, transform 0.5s ease';

    setTimeout(() => {
        welcomeSection.style.opacity = '1';
        welcomeSection.style.transform = 'translateY(0)';
    }, 100);
});

// Gestion de la barre latérale responsive
function handleResponsiveSidebar() {
    const sidebar =// Gestion de la barre latérale responsive
        function handleResponsiveSidebar() {
            const sidebar = document.querySelector('.sidebar');
            const container = document.querySelector('.container');

            if (window.innerWidth <= 768) {
                // Version mobile
                container.classList.add('mobile-view');
            } else if (window.innerWidth <= 1200) {
                // Version tablette
                container.classList.remove('mobile-view');
                container.classList.add('tablet-view');
            } else {
                // Version desktop
                container.classList.remove('mobile-view');
                container.classList.remove('tablet-view');
            }
        }

    // Appliquer la logique de responsivité au chargement et au redimensionnement
    window.addEventListener('load', handleResponsiveSidebar);
    window.addEventListener('resize', handleResponsiveSidebar);

    // Interaction avec les cartes
    const dashboardCards = document.querySelectorAll('.dashboard-card');
    dashboardCards.forEach(card => {
        card.addEventListener('mouseover', function () {
            this.style.transform = 'translateY(-5px)';
            this.style.boxShadow = '0 10px 20px rgba(0, 0, 0, 0.2)';
            this.style.transition = 'transform 0.3s ease, box-shadow 0.3s ease';
        });

        card.addEventListener('mouseout', function () {
            this.style.transform = 'translateY(0)';
            this.style.boxShadow = 'none';
        });
    });

    // Ajout de la fonctionnalité de thème
    function toggleDarkMode() {
        const root = document.documentElement;
        const currentPrimary = getComputedStyle(root).getPropertyValue('--primary').trim();

        if (currentPrimary === '#111827') {
            // Passer au mode clair
            root.style.setProperty('--primary', '#f3f4f6');
            root.style.setProperty('--secondary', '#ffffff');
            root.style.setProperty('--text-light', '#111827');
        } else {
            // Revenir au mode sombre
            root.style.setProperty('--primary', '#111827');
            root.style.setProperty('--secondary', '#1f2937');
            root.style.setProperty('--text-light', '#f3f4f6');
        }
    }

    // Ajouter un bouton de bascule de thème
    const themeToggle = document.createElement('div');
    themeToggle.classList.add('toolbar-item');
    themeToggle.innerHTML = `
<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
<circle cx="12" cy="12" r="5"></circle>
<line x1="12" y1="1" x2="12" y2="3"></line>
<line x1="12" y1="21" x2="12" y2="23"></line>
<line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
<line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
<line x1="1" y1="12" x2="3" y2="12"></line>
<line x1="21" y1="12" x2="23" y2="12"></line>
<line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
<line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
</svg>
`;
    themeToggle.style.cursor = 'pointer';
    themeToggle.addEventListener('click', toggleDarkMode);

    // Insérer le bouton de bascule de thème avant l'avatar de l'utilisateur
    const toolbar = document.querySelector('.toolbar');
    const userAvatar = document.querySelector('.user-avatar');
    toolbar.insertBefore(themeToggle, userAvatar);

    // Fonctionnalité d'export des données
    function exportData() {
        alert('Exportation des données du dashboard initiée.');
        // Simulation d'un délai de traitement
        setTimeout(() => {
            alert('Exportation réussie! Le fichier a été téléchargé.');
        }, 1500);
    }

    // Ajouter un bouton d'exportation
    const exportButton = document.createElement('div');
    exportButton.classList.add('toolbar-item');
    exportButton.innerHTML = `
<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
<polyline points="7 10 12 15 17 10"></polyline>
<line x1="12" y1="15" x2="12" y2="3"></line>
</svg>
`;
    exportButton.style.cursor = 'pointer';
    exportButton.addEventListener('click', exportData);

    // Insérer le bouton d'exportation
    toolbar.insertBefore(exportButton, themeToggle);
}
// Enhanced animations and interactions

// Particle background effect for dashboard
function createParticleBackground() {
    const particleContainer = document.createElement('div');
    particleContainer.style.position = 'fixed';
    particleContainer.style.top = '0';
    particleContainer.style.left = '0';
    particleContainer.style.width = '100%';
    particleContainer.style.height = '100%';
    particleContainer.style.pointerEvents = 'none';
    particleContainer.style.zIndex = '-1';
    document.body.appendChild(particleContainer);

    const particleCount = 50;
    const colors = ['#ffc107', '#4f46e5', '#ffffff'];

    for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement('div');
        particle.style.position = 'absolute';
        particle.style.width = `${Math.random() * 5 + 2}px`;
        particle.style.height = particle.style.width;
        particle.style.borderRadius = '50%';
        particle.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        particle.style.opacity = `${Math.random() * 0.5}`;

        // Random initial position
        particle.style.left = `${Math.random() * 100}%`;
        particle.style.top = `${Math.random() * 100}%`;

        // Animate particle movement
        function animateParticle() {
            gsap.to(particle, {
                x: (Math.random() * 200 - 100),
                y: (Math.random() * 200 - 100),
                duration: Math.random() * 10 + 5,
                ease: 'power1.inOut',
                repeat: -1,
                yoyo: true
            });
        }

        particleContainer.appendChild(particle);
        animateParticle();
    }
}

// Enhanced hover effects for menu items
function enhanceMenuItemHovers() {
    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach(item => {
        item.addEventListener('mouseenter', function () {
            gsap.to(this, {
                scale: 1.05,
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                duration: 0.3,
                ease: 'power1.out'
            });

            const icon = this.querySelector('.menu-icon');
            const text = this.querySelector('.menu-text');

            gsap.to(icon, {
                rotation: 360,
                scale: 1.2,
                color: '#ffc107',
                duration: 0.5
            });

            gsap.to(text, {
                x: 10,
                opacity: 0.8,
                duration: 0.3
            });
        });

        item.addEventListener('mouseleave', function () {
            gsap.to(this, {
                scale: 1,
                backgroundColor: 'transparent',
                duration: 0.3,
                ease: 'power1.in'
            });

            const icon = this.querySelector('.menu-icon');
            const text = this.querySelector('.menu-text');

            gsap.to(icon, {
                rotation: 0,
                scale: 1,
                color: 'currentColor',
                duration: 0.5
            });

            gsap.to(text, {
                x: 0,
                opacity: 1,
                duration: 0.3
            });
        });
    });
}

// Advanced card reveal animation
function cardRevealAnimation() {
    const cards = document.querySelectorAll('.dashboard-card, .content-card');

    cards.forEach((card, index) => {
        gsap.fromTo(card,
            {
                opacity: 0,
                y: 50,
                scale: 0.9
            },
            {
                opacity: 1,
                y: 0,
                scale: 1,
                duration: 0.6,
                delay: index * 0.1,
                ease: 'back.out(1.7)'
            }
        );
    });
}

// Metrics live update with smooth transitions
function smoothMetricsUpdate() {
    const metricValues = document.querySelectorAll('.metric-value, .card-value');

    function updateValue(element) {
        const currentValue = parseFloat(element.textContent);
        const variance = Math.random() * (currentValue * 0.1);
        const newValue = currentValue + (Math.random() > 0.5 ? variance : -variance);

        gsap.to(element, {
            textContent: newValue.toFixed(1),
            duration: 1,
            snap: { textContent: 1 },
            ease: 'power1.inOut'
        });
    }

    metricValues.forEach(value => {
        setInterval(() => updateValue(value), 10000);
    });
}

// Enhanced modal interactions
function enhanceModalAnimations() {
    const adminModal = document.getElementById('adminModal');
    const modalContent = adminModal.querySelector('.modal-content');

    // Scale and blur background when modal opens
    adminModal.addEventListener('show', function () {
        gsap.to('.main-content', {
            scale: 0.9,
            filter: 'blur(10px)',
            duration: 0.5
        });

        gsap.fromTo(modalContent,
            { scale: 0.8, opacity: 0 },
            { scale: 1, opacity: 1, duration: 0.5, ease: 'back.out(1.5)' }
        );
    });

    // Restore main content when modal closes
    adminModal.addEventListener('hide', function () {
        gsap.to('.main-content', {
            scale: 1,
            filter: 'blur(0px)',
            duration: 0.5
        });

        gsap.to(modalContent, {
            scale: 0.8,
            opacity: 0,
            duration: 0.5
        });
    });
}

// Initialize advanced animations
function initAdvancedAnimations() {
    // Check if GSAP is loaded
    if (typeof gsap !== 'undefined') {
        createParticleBackground();
        enhanceMenuItemHovers();
        cardRevealAnimation();
        smoothMetricsUpdate();
        enhanceModalAnimations();
    } else {
        console.warn('GSAP library not loaded. Some animations will be disabled.');
    }
}

// Load GSAP dynamically if not already present
function loadGSAP() {
    if (typeof gsap === 'undefined') {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.11.4/gsap.min.js';
        script.onload = initAdvancedAnimations;
        document.head.appendChild(script);
    } else {
        initAdvancedAnimations();
    }
}






// bouton courses
document.addEventListener('DOMContentLoaded', function () {
    const addCourseBtn = document.getElementById('add-course-btn');
    const courseModal = document.querySelector('.course-modal'); // Sélectionne le modal existant

    // Afficher le modal seulement au clic
    addCourseBtn.addEventListener('click', function () {
        courseModal.style.display = 'flex';
    });

    // Fermer le modal


    // Fermer en cliquant à l'extérieur
    courseModal.addEventListener('click', function (e) {
        if (e.target === courseModal) {
            courseModal.style.display = 'none';
        }
    });

    document.querySelectorAll('.add-list-item').forEach(button => {
        button.addEventListener('click', function () {
            const target = document.getElementById(this.dataset.target);
            const newInput = document.createElement('input');
            newInput.type = 'text';
            newInput.name = this.previousElementSibling.firstElementChild.name;
            target.appendChild(newInput);
        })
    });


    function resetForm() {
        const form = document.getElementById('add-course-form');

        // Réinitialiser les valeurs des champs
        form.reset();

        // Réinitialiser les étapes
        const steps = document.querySelectorAll('.form-step');
        steps.forEach(step => step.classList.remove('active'));
        steps[0].classList.add('active');

        // Réinitialiser les listes dynamiques (conserver le premier élément)
        const dynamicLists = document.querySelectorAll('.dynamic-list');
        dynamicLists.forEach(list => {
            while (list.children.length > 1) {
                list.lastChild.remove();
            }
            // Réinitialiser la valeur du premier input
            if (list.firstElementChild) {
                list.firstElementChild.querySelector('input').value = '';
            }
        });

        // Réinitialiser les fichiers
        const fileInput = document.getElementById('files');
        fileInput.value = '';
    };

    // Afficher le modal
    document.getElementById('add-course-btn').addEventListener('click', function () {
        document.querySelector('.course-modal').style.display = 'flex';
        document.body.style.overflow = 'hidden'; // Bloquer le défilement
    });

    // Fermer le modal
    document.querySelectorAll('.cancel-btn, .course-modal').forEach(element => {
        element.addEventListener('click', (e) => {
            if (e.target === element || e.target.classList.contains('cancel-btn')) {
                document.querySelector('.course-modal').style.display = 'none';
                //document.body.style.overflow = 'auto'; // Rétablir le défilement
                resetForm();
            }
        });
    });

    // Gestion des étapes du formulaire
    document.querySelectorAll('.form-step .next-step').forEach(button => {
        button.addEventListener('click', () => {
            const activeStep = document.querySelector('.form-step.active');
            const nextStep = activeStep.nextElementSibling;

            if (nextStep && nextStep.classList.contains('form-step')) {
                activeStep.classList.remove('active');
                nextStep.classList.add('active');
            }
        });
    });

    document.querySelectorAll('.form-step .prev-step').forEach(button => {
        button.addEventListener('click', () => {
            const activeStep = document.querySelector('.form-step.active');
            const prevStep = activeStep.previousElementSibling;

            if (prevStep && prevStep.classList.contains('form-step')) {
                activeStep.classList.remove('active');
                prevStep.classList.add('active');
            }
        });
    });
    // Gestion des éléments dynamiques
    document.querySelectorAll('.add-item').forEach(btn => {
        btn.addEventListener('click', function () {
            const listId = this.previousElementSibling.id;
            const newItem = document.createElement('div');
            newItem.className = 'list-item';
            newItem.innerHTML = `
<input type="text" name="${listId === 'learning-points' ? 'learning_points[]' : 'program[]'}">
<button type="button" class="remove-item">×</button>
`;
            document.getElementById(listId).appendChild(newItem);
        });
    });

    document.body.addEventListener('click', function (e) {
        if (e.target.classList.contains('remove-item')) {
            e.target.closest('.list-item').remove();
        }
    });


   document.querySelector('#add-course-form').addEventListener('submit', async function (e) {
    e.preventDefault();

    const formData = new FormData(this);
    const fileInput = document.getElementById('files');
    const courseImageInput = document.getElementById('course-image');

    // Ajout de l'image de cours
    /*if (courseImageInput && courseImageInput.files[0]) {
        formData.append('courseImage', courseImageInput.files[0]);
    }*/

    const lessons = []
    
    for (const file of fileInput.files){
        let type = file.name.split('.').pop();

        if(file.type.startsWith('video/')){
            type = 'video';
        }
        else{
            const ext = file.name.split('.').pop().toLowerCase();
            const videoExtensions = ['mp4', 'mov', 'avi', 'mkv', 'webm']

            if(videoExtensions.includes(ext)){
                type='video'
            }else{
                type = file.name.split('.').pop();
            }
        }

        lessons.push({type: type})
    }
    formData.set('lessons', JSON.stringify(lessons));
    formData.set('content', JSON.stringify([]));

    try {
        const response = await fetch('/api/course/add-course', {
            method: 'POST',
            body: formData,
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('accessToken')|| sessionStorage.getItem('accessToken')}`
            },
            credentials: 'include'
        });

        if (response.ok) {
            const newCourse = await response.json();
            displayCourses(); // Recharger la liste
            document.querySelector('.course-modal').style.display = 'none';
            resetForm(); // Réinitialiser le formulaire
        } else {
            const error = await response.json();
            console.log(error);
            alert(`Erreur: ${error.message || error.error || 'Une erreur est survenue'}`);
        }
    } catch (error) {
        console.error('Erreur:', error);
        alert('Erreur de connexion au serveur');
    }
});



    
    // Gestion de la soumission du formulaire
    document.getElementById('add-course-form').addEventListener('submit', async function(e) {
        e.preventDefault();

        // Créez FormData object
        const formData = new FormData(this);
        const learningPoints = Array.from(formData.getAll('learning_points[]')).filter(v => v);
        const program = Array.from(formData.getAll('program[]')).filter(v => v);
    
        formData.set('learning_points', JSON.stringify(learningPoints));
        formData.set('program', JSON.stringify(program));

        try {
            const response = await fetch('/api/course/add-course', {
                method: 'POST',
                body: formData
            }); 

            if (response.ok) {
                const newCourse = await response.json();
                const coursesList = document.getElementById('courses-list');
                const newCourseCard = document.createElement('div');
                newCourseCard.classList.add('content-card');
                newCourseCard.dataset.courseId = newCourse.id;
                newCourseCard.innerHTML = `
                    <div class="content-card-title">${newCourse.title}</div>
                    <div class="content-card-value">${newCourse.students || 0} étudiants</div>
                    <div class="content-card-desc">Prof: ${newCourse.prof_id}</div>
                    <div class="content-card-actions">
                        <button class="edit-btn">Modifier</button>
                        <button class="delete-btn">Supprimer</button>
                        <button class="enroll-btn">S'inscrire</button>
                    </div>
                `;
                
                coursesList.appendChild(newCourseCard);
                
                courseModal.style.display = 'none';
            } else {
                const errorData = await response.json();
                console.error('erreur lors ajout cours sur api response:',response.status, errorData)
                alert(`Erreur: ${errorData.error || 'Impossible d\'ajouter le cours'}`);
            }
        } catch (error) {
            console.error('Erreur lors de l\'ajout du cours:', error);
            alert('Une erreur est survenue');
        }
    });
});

// Add modal to body
document.body.appendChild(courseModal);

// Show modal
addCourseBtn.addEventListener('click', function () {
    courseModal.style.display = 'flex';
});

// Close modal
const cancelBtn = courseModal.querySelector('.cancel-btn');
cancelBtn.addEventListener('click', function () {
    courseModal.style.display = 'none';
    resetForm()

});

// Close modal when clicking outside
courseModal.addEventListener('click', function (e) {
    if (e.target === courseModal) {
        courseModal.style.display = 'none';
        resetForm()
    }
});



// Course Enrollment Modal Functionality
function openEnrollmentModal(courseId, courseTitle, coursePrice) {
    const enrollmentModal = document.createElement('div');
    enrollmentModal.classList.add('course-enrollment-modal');
    enrollmentModal.innerHTML = `
<div class="modal-content">
<h3>Inscription au cours : ${courseTitle}</h3>
<div class="course-details">
<p>Prix: ${coursePrice}$</p>
</div>

<form id="enrollment-form" class="enrollment-form">
<input type="hidden" name="courseId" value="${courseId}">
<div class="form-group">
<label for="name">Nom Complet</label>
<input type="text" id="name" name="name" required>
</div>

<div class="form-group">
<label for="email">Email</label>
<input type="email" id="email" name="email" required>
</div>

<div class="payment-section">
<h4>Méthode de Paiement</h4>
<div class="payment-options">
    <label>
        <input type="radio" name="payment_method" value="credit_card" required>
        Carte de Crédit
    </label>
    <label>
        <input type="radio" name="payment_method" value="paypal">
        PayPal
    </label>
    <label>
        <input type="radio" name="payment_method" value="bank_transfer">
        Virement Bancaire
    </label>
</div>
</div>

<button type="submit" class="btn-enroll">
Rejoindre pour ${coursePrice}$
</button>
</form>
</div>
`;

    // Add modal to body
    document.body.appendChild(enrollmentModal);

    // Close modal functionality
    enrollmentModal.addEventListener('click', function (e) {
        if (e.target === enrollmentModal) {
            document.body.removeChild(enrollmentModal);
        }
    });

    // Form submission
    const form = enrollmentModal.querySelector('#enrollment-form');
    form.addEventListener('submit', async function (e) {
        e.preventDefault();

        const formData = new FormData(form);
        const courseId = formData.get('courseId');

        try {
            const response = await fetch(`/api/course/${courseId}/enroll`, {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                const result = await response.json();

                // Update student count in the corresponding course card
                const courseCard = document.querySelector(`.content-card[data-course-id="${courseId}"]`);
                if (courseCard) {
                    const studentCountEl = courseCard.querySelector('.content-card-value');
                    const currentCount = parseInt(studentCountEl.textContent);
                    studentCountEl.textContent = `${currentCount + 1} étudiants`;
                }

                // Redirect to Stripe payment or handle success
                alert('Inscription réussie! Procédez au paiement.');

                // Remove modal
                document.body.removeChild(enrollmentModal);
            } else {
                const errorData = await response.json();
                alert(`Erreur: ${errorData.error || 'Impossible de s\'inscrire'}`);
            }
        } catch (error) {
            console.error('Erreur lors de l\'inscription:', error);
            alert('Une erreur est survenue');
        }
    });
}

// Add enrollment functionality to existing course cards
document.querySelectorAll('.content-card').forEach(card => {
    const enrollButton = document.createElement('button');
    enrollButton.textContent = 'S\'inscrire';
    enrollButton.classList.add('enroll-btn');

    enrollButton.addEventListener('click', function () {
        const title = card.querySelector('.content-card-title').textContent;
        const value = card.querySelector('.content-card-value').textContent;
        const price = value.match(/\d+/)[0]; // Extract price from text
        const courseId = card.dataset.courseId;

        openEnrollmentModal(courseId, title, price);
    });

    card.querySelector('.content-card-actions').appendChild(enrollButton);
});


//
// Suite du code d'implémentation CRUD de la loterie

// Ajout d'un modal pour la visualisation des participants
const participantsModal = document.createElement('div');
participantsModal.className = 'course-modal';
participantsModal.innerHTML = `
<div class="modal-content">
<h3>Participants au tirage: <span id="participants-lottery-name"></span></h3>
<div class="participants-list-container">
<table class="participants-table">
<thead>
<tr>
    <th>Nom</th>
    <th>Email</th>
    <th>Numéro de ticket</th>
    <th>Date d'achat</th>
</tr>
</thead>
<tbody id="participants-list">
<!-- Liste des participants -->
</tbody>
</table>
</div>
<div class="modal-actions">
<button type="button" class="cancel-btn">Fermer</button>
<button type="button" class="draw-winner-btn">Effectuer le tirage</button>
</div>
</div>
`;
document.body.appendChild(participantsModal);

// Ajouter le style pour la table des participants
const style = document.createElement('style');
style.textContent = `
.participants-list-container {
max-height: 300px;
overflow-y: auto;
margin-bottom: 20px;
}

.participants-table {
width: 100%;
border-collapse: collapse;
}

.participants-table th, .participants-table td {
padding: 8px;
text-align: left;
border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.participants-table th {
background-color: rgba(79, 70, 229, 0.1);
color: var(--gold);
}

.participants-table tr:hover {
background-color: rgba(255, 255, 255, 0.05);
}

.modal-actions {
display: flex;
justify-content: space-between;
margin-top: 20px;
}

.draw-winner-btn {
background-color: var(--gold);
color: var(--primary);
border: none;
padding: 8px 16px;
border-radius: 4px;
cursor: pointer;
font-weight: bold;
}

.draw-winner-btn:hover {
background-color: var(--gold-dark);
}

.no-participants {
text-align: center;
padding: 20px;
color: rgba(255, 255, 255, 0.5);
}

/* Modal pour le tirage au sort */
.winner-modal {
max-width: 500px;
}

.winner-card {
background-color: var(--primary);
border-radius: 8px;
padding: 15px;
margin-bottom: 15px;
border-left: 3px solid var(--gold);
}

.winner-name {
font-size: 18px;
font-weight: bold;
margin-bottom: 5px;
color: var(--gold);
}

.winner-email, .winner-ticket {
font-size: 14px;
margin-bottom: 5px;
}

.winner-animation {
animation: winnerGlow 1.5s infinite alternate;
}

@keyframes winnerGlow {
from {
box-shadow: 0 0 5px rgba(255, 193, 7, 0.3);
}
to {
box-shadow: 0 0 20px rgba(255, 193, 7, 0.6);
}
}
`;
document.head.appendChild(style);

// Créer le modal pour l'affichage des gagnants
const winnersDrawModal = document.createElement('div');
winnersDrawModal.className = 'course-modal';
winnersDrawModal.innerHTML = `
<div class="modal-content winner-modal">
<h3>Résultat du tirage au sort</h3>
<div id="winners-container">
<!-- Les gagnants seront affichés ici -->
</div>
<div class="form-actions">
<button type="button" class="cancel-btn">Fermer</button>
<button type="button" class="save-winners-btn">Enregistrer les résultats</button>
</div>
</div>
`;
document.body.appendChild(winnersDrawModal);

// Gérer la fermeture des modals
participantsModal.querySelector('.cancel-btn').addEventListener('click', function () {
    participantsModal.style.display = 'none';
});

winnersDrawModal.querySelector('.cancel-btn').addEventListener('click', function () {
    winnersDrawModal.style.display = 'none';
});

// Fermer les modals en cliquant en dehors
participantsModal.addEventListener('click', function (e) {
    if (e.target === participantsModal) {
        participantsModal.style.display = 'none';
    }
});

winnersDrawModal.addEventListener('click', function (e) {
    if (e.target === winnersDrawModal) {
        winnersDrawModal.style.display = 'none';
    }
});





// Modifier la fonction pour afficher les participants
async function showParticipants(lotteryId, productName) {
    // Mettre à jour le titre du modal
    document.getElementById('participants-lottery-name').textContent = productName;

    try {
        // Simuler une requête API pour récupérer les participants
        // Dans une implémentation réelle, vous feriez une requête vers votre API
        // Par exemple: const response = await fetch(`/api/lottery/participants/${lotteryId}`);

        // Pour l'instant, utilisons des données fictives
        const participants = [
            { id: 1, name: "Jean Dupont", email: "jean.dupont@example.com", ticketNumber: "LD-" + lotteryId + "-001", purchaseDate: "2025-03-15T10:30:00" },
            { id: 2, name: "Marie Martin", email: "marie.martin@example.com", ticketNumber: "LD-" + lotteryId + "-002", purchaseDate: "2025-03-16T14:45:00" },
            { id: 3, name: "Pierre Durand", email: "pierre.durand@example.com", ticketNumber: "LD-" + lotteryId + "-003", purchaseDate: "2025-03-17T09:15:00" },
            { id: 4, name: "Sophie Leroy", email: "sophie.leroy@example.com", ticketNumber: "LD-" + lotteryId + "-004", purchaseDate: "2025-03-18T16:20:00" }
        ];

        const participantsList = document.getElementById('participants-list');
        participantsList.innerHTML = '';

        if (participants.length === 0) {
            participantsList.innerHTML = '<tr><td colspan="4" class="no-participants">Aucun participant pour ce tirage</td></tr>';
        } else {
            participants.forEach(participant => {
                const purchaseDate = new Date(participant.purchaseDate);
                const formattedDate = purchaseDate.toLocaleDateString('fr-FR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });

                const row = document.createElement('tr');
                row.innerHTML = `
<td>${participant.name}</td>
<td>${participant.email}</td>
<td>${participant.ticketNumber}</td>
<td>${formattedDate}</td>
`;
                participantsList.appendChild(row);
            });
        }

        // Stocker les participants pour une utilisation ultérieure
        participantsModal.dataset.participants = JSON.stringify(participants);
        participantsModal.dataset.lotteryId = lotteryId;
        participantsModal.dataset.lotteryName = productName;

        // Afficher le modal
        participantsModal.style.display = 'flex';

        // Mettre à jour le bouton de tirage en fonction du nombre de participants
        const drawWinnerBtn = participantsModal.querySelector('.draw-winner-btn');
        if (participants.length === 0) {
            drawWinnerBtn.disabled = true;
            drawWinnerBtn.style.opacity = '0.5';
            drawWinnerBtn.style.cursor = 'not-allowed';
        } else {
            drawWinnerBtn.disabled = false;
            drawWinnerBtn.style.opacity = '1';
            drawWinnerBtn.style.cursor = 'pointer';
        }

    } catch (error) {
        console.error('Erreur lors de la récupération des participants:', error);
        alert('Une erreur est survenue lors de la récupération des participants');
    }
}

// Mettre à jour la fonction attachLotteryEventListeners pour inclure l'affichage des participants
function attachLotteryEventListeners() {
    // [Le code existant pour modifier et supprimer reste inchangé]

    // Voir les participants
    drawsContent.querySelectorAll('.view-participants-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const card = this.closest('.content-card');
            const lotteryId = card.dataset.lotteryId;
            const productName = card.querySelector('.content-card-title').textContent;

            showParticipants(lotteryId, productName);
        });
    });
}

// Ajouter la fonctionnalité de tirage au sort
participantsModal.querySelector('.draw-winner-btn').addEventListener('click', function () {
    const lotteryId = participantsModal.dataset.lotteryId;
    const lotteryName = participantsModal.dataset.lotteryName;
    const participantsJson = participantsModal.dataset.participants;

    if (!participantsJson) {
        alert('Aucun participant disponible pour le tirage');
        return;
    }

    const participants = JSON.parse(participantsJson);
    if (participants.length === 0) {
        alert('Aucun participant disponible pour le tirage');
        return;
    }

    // Déterminer le nombre de gagnants (par défaut: 1 ou moins si peu de participants)
    const winnerCount = Math.min(1, participants.length);

    // Sélectionner aléatoirement des gagnants
    const winners = [];
    const participantsCopy = [...participants];

    for (let i = 0; i < winnerCount; i++) {
        const randomIndex = Math.floor(Math.random() * participantsCopy.length);
        winners.push(participantsCopy[randomIndex]);
        participantsCopy.splice(randomIndex, 1);
    }

    // Afficher les gagnants
    const winnersContainer = document.getElementById('winners-container');
    winnersContainer.innerHTML = '';

    winners.forEach((winner, index) => {
        const winnerCard = document.createElement('div');
        winnerCard.className = 'winner-card winner-animation';
        winnerCard.innerHTML = `
<div class="winner-name">${index + 1}. ${winner.name}</div>
<div class="winner-email">Email: ${winner.email}</div>
<div class="winner-ticket">Ticket: ${winner.ticketNumber}</div>
`;
        winnersContainer.appendChild(winnerCard);
    });

    // Stocker les données pour l'enregistrement
    winnersDrawModal.dataset.lotteryId = lotteryId;
    winnersDrawModal.dataset.lotteryName = lotteryName;
    winnersDrawModal.dataset.winners = JSON.stringify(winners);

    // Fermer le modal des participants et ouvrir celui des gagnants
    participantsModal.style.display = 'none';
    winnersDrawModal.style.display = 'flex';
});

// Enregistrer les résultats du tirage
winnersDrawModal.querySelector('.save-winners-btn').addEventListener('click', async function () {
    const lotteryId = winnersDrawModal.dataset.lotteryId;
    const lotteryName = winnersDrawModal.dataset.lotteryName;
    const winners = JSON.parse(winnersDrawModal.dataset.winners);

    try {
        // Dans une implémentation réelle, vous feriez une requête vers votre API
        // Par exemple:
        // const response = await fetch('/api/lottery/save-winners', {
        //     method: 'POST',
        //     headers: {
        //         'Content-Type': 'application/json',
        //         'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
        //     },
        //     body: JSON.stringify({
        //         lotteryId,
        //         winners
        //     })
        // });

        // Simuler une réponse réussie
        setTimeout(() => {
            alert(`Les gagnants pour "${lotteryName}" ont été enregistrés avec succès!`);
            winnersDrawModal.style.display = 'none';

            // Mettre à jour l'UI pour indiquer que le tirage a été effectué
            const lotteryCard = document.querySelector(`.content-card[data-lottery-id="${lotteryId}"]`);
            if (lotteryCard) {
                const viewParticipantsBtn = lotteryCard.querySelector('.view-participants-btn');
                if (viewParticipantsBtn) {
                    viewParticipantsBtn.textContent = 'Gagnants';
                    viewParticipantsBtn.classList.remove('view-participants-btn');
                    viewParticipantsBtn.classList.add('view-winners-btn');
                    viewParticipantsBtn.style.backgroundColor = 'var(--gold)';
                    viewParticipantsBtn.style.color = 'var(--primary)';
                }
            }
        }, 1000);

    } catch (error) {
        console.error('Erreur lors de l\'enregistrement des gagnants:', error);
        alert('Une erreur est survenue lors de l\'enregistrement des gagnants');
    }
});

// Ajouter une fonction pour exporter les données des tirages
function addExportFunctionality() {
    const drawsHeader = drawsContent.querySelector('.content-header');
    const exportBtn = document.createElement('button');
    exportBtn.className = 'add-course-btn';
    exportBtn.style.marginLeft = '10px';
    exportBtn.innerHTML = `
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
<polyline points="7 10 12 15 17 10"></polyline>
<line x1="12" y1="15" x2="12" y2="3"></line>
</svg>
Exporter
`;
    drawsHeader.appendChild(exportBtn);

    exportBtn.addEventListener('click', async function () {
        try {
            const lotteries = await fetchLotteries();

            // Formater les données pour l'export
            const exportData = lotteries.map(lottery => {
                const lotteryDate = new Date(lottery.lotteryTime);
                const formattedDate = lotteryDate.toLocaleDateString('fr-FR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric'
                });

                return {
                    'ID': lottery.lotteryId,
                    'Nom du produit': lottery.nomProduit,
                    'Date du tirage': formattedDate,
                    'Coût du ticket ($)': lottery.entrieCost,
                    'Statut': new Date() > new Date(lottery.lotteryTime) ? 'Terminé' : 'En cours'
                };
            });

            // Convertir en CSV
            let csv = '';
            const headers = Object.keys(exportData[0]);
            csv += headers.join(',') + '\n';

            exportData.forEach(row => {
                const values = headers.map(header => {
                    const value = row[header] + '';
                    // Échapper les virgules et les guillemets
                    return `"${value.replace(/"/g, '""')}"`;
                });
                csv += values.join(',') + '\n';
            });

            // Créer un fichier Blob et le télécharger
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.setAttribute('href', url);
            link.setAttribute('download', `tirages_loterie_${new Date().toISOString().slice(0, 10)}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            alert('Export réussi! Le fichier a été téléchargé.');
        } catch (error) {
            console.error('Erreur lors de l\'export des données:', error);
            alert('Une erreur est survenue lors de l\'export des données');
        }
    });
}

// Appeler la fonction pour ajouter la fonctionnalité d'export
addExportFunctionality();

// Ajouter une fonctionnalité de recherche pour les tirages
function addSearchFunctionality() {
    const drawsHeader = drawsContent.querySelector('.content-header');
    const searchContainer = document.createElement('div');
    searchContainer.className = 'search-container-lottery';
    searchContainer.style.marginTop = '15px';
    searchContainer.style.marginBottom = '15px';
    searchContainer.innerHTML = `
<input type="text" id="lottery-search" placeholder="Rechercher un tirage..." class="search-input">
`;
    drawsHeader.after(searchContainer);

    // Ajouter le style pour la recherche
    const searchStyle = document.createElement('style');
    searchStyle.textContent = `
.search-container-lottery {
width: 100%;
max-width: 400px;
}

.search-input {
width: 100%;
padding: 8px 12px;
border-radius: 4px;
border: 1px solid rgba(255, 255, 255, 0.1);
background-color: rgba(0, 0, 0, 0.2);
color: var(--text-light);
font-size: 14px;
}

.search-input:focus {
outline: none;
border-color: var(--gold);
box-shadow: 0 0 5px rgba(255, 193, 7, 0.3);
}
`;
    document.head.appendChild(searchStyle);

    // Fonctionnalité de recherche
    const searchInput = document.getElementById('lottery-search');
    searchInput.addEventListener('input', function () {
        const searchTerm = this.value.toLowerCase();
        const cards = drawsContent.querySelectorAll('.content-card');

        cards.forEach(card => {
            const title = card.querySelector('.content-card-title').textContent.toLowerCase();
            const date = card.querySelector('.content-card-value').textContent.toLowerCase();
            const desc = card.querySelector('.content-card-desc').textContent.toLowerCase();

            if (title.includes(searchTerm) || date.includes(searchTerm) || desc.includes(searchTerm)) {
                card.style.display = '';
            } else {
                card.style.display = 'none';
            }
        });
    });
}

// Appeler la fonction pour ajouter la fonctionnalité de recherche
addSearchFunctionality();

// Ajout d'un système de statistiques simples pour les tirages
function addLotteryStatistics() {
    // Créer la section de statistiques
    const statsContainer = document.createElement('div');
    statsContainer.className = 'lottery-stats-container';
    statsContainer.style.marginBottom = '20px';
    statsContainer.innerHTML = `
<div class="stats-header">
<h4>Statistiques des tirages</h4>
</div>
<div class="stats-cards">
<div class="stats-card">
<div class="stats-icon">
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>
</svg>
</div>
<div class="stats-info">
<div class="stats-value" id="total-lotteries">0</div>
<div class="stats-label">Total des tirages</div>
</div>
</div>
<div class="stats-card">
<div class="stats-icon">
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="10"></circle>
    <polyline points="12 6 12 12 16 14"></polyline>
</svg>
</div>
<div class="stats-info">
<div class="stats-value" id="active-lotteries">0</div>
<div class="stats-label">Tirages actifs</div>
</div>
</div>
<div class="stats-card">
<div class="stats-icon">
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="12" y1="1" x2="12" y2="23"></line>
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
</svg>
</div>
<div class="stats-info">
<div class="stats-value" id="avg-ticket-price">0$</div>
<div class="stats-label">Prix moyen du ticket</div>
</div>
</div>
</div>
`;

    // Ajouter le style pour les statistiques
    const statsStyle = document.createElement('style');
    statsStyle.textContent = `
.lottery-stats-container {
background-color: var(--secondary);
border-radius: 10px;
padding: 15px;
}

.stats-header h4 {
margin: 0 0 15px 0;
color: var(--gold);
font-size: 16px;
}

.stats-cards {
display: flex;
gap: 15px;
flex-wrap: wrap;
}

.stats-card {
flex: 1;
min-width: 150px;
background-color: rgba(0, 0, 0, 0.2);
border-radius: 8px;
padding: 15px;
display: flex;
align-items: center;
gap: 15px;
transition: all 0.3s ease;
}

.stats-card:hover {
transform: translateY(-5px);
box-shadow: 0 5px 15px rgba(0, 0, 0, 0.2);
}

.stats-icon {
background-color: rgba(79, 70, 229, 0.1);
width: 40px;
height: 40px;
border-radius: 50%;
display: flex;
align-items: center;
justify-content: center;
color: var(--gold);
}

.stats-value {
font-size: 24px;
font-weight: bold;
margin-bottom: 5px;
}

.stats-label {
font-size: 14px;
color: rgba(255, 255, 255, 0.7);
}

@media (max-width: 768px) {
.stats-cards {
flex-direction: column;
}
}
`;
    document.head.appendChild(statsStyle);

    // Insérer les statistiques avant la liste des tirages
    const lotteriesContainer = drawsContent.querySelector('.content-body');
    lotteriesContainer.before(statsContainer);

    // Fonction pour mettre à jour les statistiques
    async function updateLotteryStatistics() {
        try {
            const lotteries = await fetchLotteries();
            const now = new Date();

            // Calculer les statistiques
            const totalLotteries = lotteries.length;
            const activeLotteries = lotteries.filter(lottery => new Date(lottery.lotteryTime) > now).length;

            // Calculer le prix moyen des tickets
            let totalPrice = 0;
            lotteries.forEach(lottery => {
                totalPrice += parseFloat(lottery.entrieCost);
            });
            const avgPrice = totalLotteries > 0 ? (totalPrice / totalLotteries).toFixed(2) : '0.00';

            // Mettre à jour l'affichage
            document.getElementById('total-lotteries').textContent = totalLotteries;
            document.getElementById('active-lotteries').textContent = activeLotteries;
            document.getElementById('avg-ticket-price').textContent = avgPrice + '$';
        } catch (error) {
            console.error('Erreur lors de la mise à jour des statistiques:', error);
        }
    }

    // Mettre à jour les statistiques au chargement et après chaque opération CRUD
    updateLotteryStatistics();

    // Étendre les fonctions existantes pour mettre à jour les statistiques
    const originalDisplayLotteries = displayLotteries;
    displayLotteries = async function () {
        await originalDisplayLotteries();
        updateLotteryStatistics();
    };
}







// Appeler la fonction pour ajouter les statistiques
addLotteryStatistics();




// Run on document load
document.addEventListener('DOMContentLoaded', loadGSAP);
