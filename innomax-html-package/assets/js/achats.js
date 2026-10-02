import { secureFetch, initializeCSRF } from './api.js';

// Variables globales
let currentProduct = null;
let selectedSize = null;
const productModal = document.getElementById('productModal');
const modalClose = document.querySelector('.close-product-modal');

// Modified function to show error messages above specific fields
function showError(fieldId, message) {
    // First remove any existing error for this field
    const existingError = document.querySelector(`#${fieldId}-error`);
    if (existingError) {
        existingError.remove();
    }

    if (!message) return; // If no message, just clear the error

    const field = document.getElementById(fieldId);
    if (!field) return;

    const errorDiv = document.createElement('div');
    errorDiv.id = `${fieldId}-error`;
    errorDiv.className = 'field-error-message';
    errorDiv.textContent = message;
    errorDiv.style.color = 'red'; // Make text red
    errorDiv.style.marginBottom = '5px'; // Add some spacing

    // Insert the error message above the field
    field.parentNode.insertBefore(errorDiv, field);

    // Highlight the field
    field.classList.add('error-field');
    field.style.borderColor = 'red'; // Add red border to field

    // Auto-remove after 5 seconds
    setTimeout(() => {
        errorDiv.style.opacity = '0';
        setTimeout(() => {
            errorDiv.remove();
            field.classList.remove('error-field');
            field.style.borderColor = ''; // Reset border color
        }, 300);
    }, 5000);
}
// Fonction pour vérifier si l'utilisateur est connecté
async function checkUserAuthentication() {
    try {
        const response = await fetch('/api/auth/validateToken', {
            method: 'GET',
        });
        
        const data = await response.json();
        return data.success === true;
    } catch (error) {
        console.error("Erreur lors de la vérification de l'authentification:", error);
        return false;
    }
}

// Fonction pour ouvrir le modal
async function openProductModal(product) {
    currentProduct = product;
    
    // Mise à jour du contenu du modal
    const modalTitle = document.querySelector('.product-modal-title');
    if (modalTitle) modalTitle.textContent = product.nomProduit;
    
    const modalImage = document.querySelector('.product-modal-image');
    if (modalImage) {
        modalImage.src = product.imageProduit;
        modalImage.alt = product.nomProduit;
    }
    
    // Afficher le prix (utiliser price au lieu de entrieCost)
    const modalPrice = document.querySelector('.product-price');
    if (modalPrice) {
        if (product.price && product.price > 0) {
            modalPrice.textContent = `$${product.price}`;
        } else {
            modalPrice.textContent = `$${product.entrieCost || '0'}`;
        }
    }
    
    // Afficher la description complète
    const modalDescription = document.querySelector('.product-description');
    const productAttributes = document.querySelector('.product-attributes');
    
    if (modalDescription) {
        if (product.fullDescription && product.fullDescription.trim() !== '') {
            modalDescription.innerHTML = window.escapeHtml(product.fullDescription).replace(/\n/g, '<br>');
            if (productAttributes) productAttributes.style.display = 'none';
        } else if (product.shortDescription && product.shortDescription.trim() !== '') {
            modalDescription.innerHTML = window.escapeHtml(product.shortDescription).replace(/\n/g, '<br>');
            if (productAttributes) productAttributes.style.display = 'none';
        } else {
            modalDescription.textContent = 'No description available';
            if (productAttributes) productAttributes.style.display = 'none';
        }
    }
    
    // Gestion du sélecteur de taille
    const sizeSelectorContainer = document.getElementById('size-selector-container');
    if (!sizeSelectorContainer) {
        console.error("Element 'size-selector-container' not found");
    } else {
        // Vérifier si le produit a besoin de sélection de taille (if_size)
        if (product.if_size) {
            // Afficher le sélecteur de taille
            sizeSelectorContainer.style.display = 'block';
            selectedSize = null; // Réinitialiser la taille sélectionnée
            
            // Configurer les options de taille
            const sizeOptions = document.querySelector('.size-options');
            if (sizeOptions) {
                // Vider le conteneur des tailles
                sizeOptions.innerHTML = '';
                
                // Déterminer les tailles appropriées pour ce type de vêtement
                let sizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
                
                // Créer les options de taille
                sizes.forEach(size => {
                    const sizeElement = document.createElement('div');
                    sizeElement.className = 'size-option';
                    sizeElement.setAttribute('data-size', size);
                    sizeElement.textContent = size;
                    
                    // Ajouter l'écouteur d'événement sur le clic
                    sizeElement.addEventListener('click', function() {
                        // Désélectionner toutes les autres tailles
                        document.querySelectorAll('.size-option').forEach(option => {
                            option.classList.remove('selected');
                        });
                        
                        // Sélectionner cette taille
                        this.classList.add('selected');
                        selectedSize = size;
                        
                        // Remove size error if it exists
                        const sizeError = document.querySelector('.size-error');
                        if (sizeError) {
                            sizeError.style.display = 'none';
                        }
                    });
                    
                    // Ajouter au conteneur
                    sizeOptions.appendChild(sizeElement);
                });
            }
        } else {
            // Cacher le sélecteur de taille pour les produits qui n'ont pas besoin de taille
            sizeSelectorContainer.style.display = 'none';
            selectedSize = 'N/A'; // Taille non applicable
        }
    }
    
    // Reset de la quantité
    const quantityInput = document.querySelector('.quantity-input');
    if (quantityInput) quantityInput.value = 1;
    
    // Afficher le modal
    if (productModal) {
        productModal.style.display = 'flex';
        productModal.style.animation = 'fadeIn 0.3s ease-out';
    }
}

// Fermer le modal
function closeProductModal() {
    productModal.style.animation = 'fadeOut 0.3s ease-out';
    productModal.style.display = 'none';

    setTimeout(() => {
        productModal.style.display = 'none';
        currentProduct = null;
    }, 300);
}

// Gestion de la quantité
function setupQuantityControls() {
    const decreaseBtn = document.querySelector('.decrease-quantity');
    const increaseBtn = document.querySelector('.increase-quantity');
    const quantityInput = document.querySelector('.quantity-input');
    
    decreaseBtn.addEventListener('click', () => {
        let currentValue = parseInt(quantityInput.value);
        if (currentValue > 1) {
            quantityInput.value = currentValue - 1;
        }
    });
    
    increaseBtn.addEventListener('click', () => {
        let currentValue = parseInt(quantityInput.value);
        if (currentValue < 10) {
            quantityInput.value = currentValue + 1;
        }
    });
    
    quantityInput.addEventListener('change', () => {
        let value = parseInt(quantityInput.value);
        if (isNaN(value) || value < 1) {
            quantityInput.value = 1;
        } else if (value > 10) {
            quantityInput.value = 10;
        }
    });
}

// Gestion des tailles
function setupSizeSelection() {
    const sizeOptions = document.querySelectorAll('.size-option');
    
    sizeOptions.forEach(option => {
        option.addEventListener('click', () => {
            // Désélectionner toutes les options
            sizeOptions.forEach(opt => opt.classList.remove('selected'));
            
            // Sélectionner l'option actuelle
            option.classList.add('selected');
            selectedSize = option.getAttribute('data-size');
        });
    });
}

// Fonction de paiement Stripe
async function proceedToCheckout() {
    let originalText = '';
    const purchaseBtn = document.getElementById('productPurchaseBtn');
    if (purchaseBtn) {
        originalText = purchaseBtn.textContent;
    }

    // Clear previous errors
    document.querySelectorAll('.error-message').forEach(el => el.remove());
    document.querySelectorAll('.error-field').forEach(el => el.classList.remove('error-field'));
    
    if (!currentProduct) {
        showError('productModal', 'No product selected. Please try again.');
        return;
    }

    // Validate size selection (if required)
    const sizeSelectorContainer = document.getElementById('size-selector-container');
    const isSizeRequired = currentProduct.if_size;
    
    if (isSizeRequired && !selectedSize) {
        showError('size-selector-container', 'Please select a size before proceeding to checkout.');
        return;
    }

    // Validate quantity
    const quantityInput = document.querySelector('.quantity-input');
    const quantity = parseInt(quantityInput.value);
    if (isNaN(quantity) || quantity < 1 || quantity > 10) {
        const quantityError = document.createElement('div');
        quantityError.className = 'quantity-error';
        quantityError.textContent = 'Please enter a valid quantity between 1 and 10.';
        quantityInput.parentNode.appendChild(quantityError);
        quantityError.style.display = 'block';
        showError('quantity-input', 'Please enter a valid quantity between 1 and 10.');
        return;
    }



    try {
         // Initialize CSRF token first
         await initializeCSRF();
        // Show loading indicator
        if (purchaseBtn) {
            purchaseBtn.textContent = 'Processing...';
            purchaseBtn.disabled = true;
        }

        // Determine which endpoint to use based on product type
        let endpoint, purchaseData;
        
        if (currentProduct.type === 'achat') {
            // Use achats endpoint
            endpoint = '/api/achats/purchase';
            purchaseData = {
                productId: currentProduct.id,
                quantity: quantity,
            };
            
            // Add size if selected
            if (selectedSize && selectedSize !== 'N/A') {
                purchaseData.size = selectedSize;
            }
        } else {
            // Use lottery endpoint
            endpoint = '/api/lottery/create-purchase-product-session';
            purchaseData = {
                lotteryId: currentProduct.lotteryId,
                entryQuantity: quantity,
                buyable: currentProduct.buyable,
                price: currentProduct.price,
            };
            
            // Add size if selected
            if (selectedSize && selectedSize !== 'N/A') {
                purchaseData.size = selectedSize;
            }
        }

        console.log('Sending request to:', endpoint);
        console.log('Purchase data:', purchaseData);

        // Send request to server
        const response = await secureFetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(purchaseData)
        });

        console.log('Response status:', response.status);
        console.log('Response ok:', response.ok);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('Server error response:', errorData);
            throw new Error(errorData.message || errorData.error || `Server error: ${response.status}`);
        }

        const data = await response.json();
        console.log('Response data:', data);

        if (!data.id) {
            throw new Error('No session ID received from server');
        }

         // Redirect to Stripe
        if (!window.stripePublicKey) {
            throw new Error('Stripe configuration error');
        }
        const stripe = Stripe(window.stripePublicKey);                
        const { error } = await stripe.redirectToCheckout({ sessionId: data.id });

        if (error) {
            throw new Error(error.message);
        }

    } catch (error) {
        console.error('Error in proceedToCheckout:', error);
        showError('productModal', `Payment Error: ${error.message}`);

        // Always restore button state
        const purchaseBtn = document.getElementById('productPurchaseBtn');
        if (purchaseBtn) {
            purchaseBtn.textContent = originalText || 'PROCEED TO CHECKOUT';
            purchaseBtn.disabled = false;
        }
    }
}

// Chargement des produits
document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken');
    const container = document.getElementById('products-container');
    
    // Add browser detection for debugging
    const userAgent = navigator.userAgent;
    console.log('Browser detected:', userAgent);
    
    try {
        console.log('Starting product loading...');
        
        // Fetch lottery products with better error handling
        let lotteryProducts = [];
        try {
            const lotteryRes = await fetch('/api/lottery/lotteryUserData', {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Cache-Control': 'no-cache'
                }
            });
            console.log('Lottery API response status:', lotteryRes.status);
            if (!lotteryRes.ok) {
                console.error('Lottery API error:', lotteryRes.status, lotteryRes.statusText);
            } else {
                lotteryProducts = await lotteryRes.json();
                console.log('Lottery products fetched:', lotteryProducts);
            }
        } catch (lotteryError) {
            console.error('Error fetching lottery products:', lotteryError);
        }

        // Fetch achats products with better error handling
        let achatsProducts = [];
        try {
            const achatsRes = await fetch('/api/achats', {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Cache-Control': 'no-cache'
                }
            });
            console.log('Achats API response status:', achatsRes.status);
            if (!achatsRes.ok) {
                console.error('Achats API error:', achatsRes.status, achatsRes.statusText);
            } else {
                achatsProducts = await achatsRes.json();
                console.log('Achats products fetched:', achatsProducts);
            }
        } catch (achatsError) {
            console.error('Error fetching achats products:', achatsError);
        }
        
        console.log('Total lottery products:', lotteryProducts.length);
        console.log('Total achats products:', achatsProducts.length);

        // Merge and normalize products with better error handling
        const buyableLotteryProducts = Array.isArray(lotteryProducts) ? lotteryProducts.filter(product => product.buyable === true) : [];
        console.log('Buyable lottery products:', buyableLotteryProducts.length);
        
        const normalizedAchatsProducts = Array.isArray(achatsProducts) ? achatsProducts.map(product => {
            console.log('Processing achats product:', product);
            return {
                ...product,
                lotteryId: null, // No lotteryId for achats
                type: 'achat',
            };
        }) : [];
        
        const normalizedLotteryProducts = buyableLotteryProducts.map(product => ({
            ...product,
            type: 'lottery',
        }));
        
        const allProducts = [...normalizedLotteryProducts, ...normalizedAchatsProducts];
        
        console.log('Final product counts:');
        console.log('- Lottery products:', normalizedLotteryProducts.length);
        console.log('- Achats products:', normalizedAchatsProducts.length);
        console.log('- Total products:', allProducts.length);
        console.log('All products:', allProducts);

        // Render all products with better error handling
        if (allProducts.length > 0) {
            const jsProductsHTML = allProducts.map(product => {
                console.log('Rendering product:', product);
                return `
                    <div class="parent">
                        <div class="card">
                            <div class="content-box">
                                <img src="${window.safeUrl(product.imageProduit || '/assets/img/placeholder.jpg')}" alt="${window.escapeHtml(product.nomProduit || 'Product')}" class="product-image" />
                                <span class="card-title">${window.escapeHtml(product.nomProduit || 'Product Name')}</span>
                                <div class="price-tag">$${window.escapeHtml(product.price || product.entrieCost || '0')}</div>
                                <a href="#" class="buy-now-btn" data-product-id="${window.escapeHtml(product.lotteryId || product.id)}" data-type="${window.escapeHtml(product.type)}"></a>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
            
            // Replace container content with all products
            container.innerHTML = jsProductsHTML;
            console.log('Products rendered successfully');
        } else {
            // If no products, show a message with retry option
            container.innerHTML = `
                <div style="text-align:center; width:100%; color:#E6C373;">
                    <p>No products available. Please check your connection and try again.</p>
                    <button onclick="location.reload()" style="background:#E6C373; color:#000; border:none; padding:10px 20px; border-radius:5px; cursor:pointer;">
                        Retry Loading Products
                    </button>
                </div>
            `;
            console.log('No products available to render');
        }

        // Add event listeners for Buy Now buttons
        document.querySelectorAll('.buy-now-btn').forEach(button => {
            button.addEventListener('click', async (event) => {
                event.preventDefault();
                const productId = button.getAttribute('data-product-id');
                const type = button.getAttribute('data-type');
                let product;
                if (type === 'lottery') {
                    product = normalizedLotteryProducts.find(p => String(p.lotteryId) === String(productId));
                } else {
                    product = normalizedAchatsProducts.find(p => String(p.id) === String(productId));
                }
                if (product) {
                    await openProductModal(product);
                }
            });
        });

        // Initialiser les contrôles du modal
        setupQuantityControls();
        setupSizeSelection();

        // Écouteur pour le bouton d'achat
        const purchaseBtn = document.getElementById('productPurchaseBtn');
        if (purchaseBtn) {
            purchaseBtn.addEventListener('click', proceedToCheckout);
        }

        // Écouteur pour fermer le modal
        if (modalClose) {
            modalClose.addEventListener('click', closeProductModal);
        }

        // Fermer le modal quand on clique à l'extérieur
        if (productModal) {
            productModal.addEventListener('click', (event) => {
                if (event.target === productModal) {
                    closeProductModal();
                }
            });
        }

    } catch (err) {
        console.error("Error in main product loading:", err);
        container.innerHTML = `
            <div style="text-align:center; width:100%; color:#E6C373;">
                <p>Error loading products. Please try again later.</p>
                <button onclick="location.reload()" style="background:#E6C373; color:#000; border:none; padding:10px 20px; border-radius:5px; cursor:pointer;">
                    Retry Loading Products
                </button>
            </div>
        `;
        showError('products-container', 'Error loading products. Please try again later.');
    }
});