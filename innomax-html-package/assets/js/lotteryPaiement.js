import { secureFetch, initializeCSRF } from './api.js';

let canvasSpeed = 0.05; // Initial max speed
let isPickingWinner = false;
let isInitializing = false;

function getLotteryIdFromURL() {
    const params = new URLSearchParams(window.location.search);
    return params.get("lotteryId");
}

function disableLotteryForm() {
    // Disable the quantity input
    const quantityInput = document.getElementById('entry-quantity');
    if (quantityInput) {
        quantityInput.disabled = true;
        quantityInput.classList.add('disabled-input');
    }
    
    // Disable the hidden input
    const hiddenQuantityInput = document.getElementById('entry-quantity-hidden');
    if (hiddenQuantityInput) {
        hiddenQuantityInput.disabled = true;
    }
    
    // Disable the submit button
    const submitButton = document.querySelector('#payment-form button[type="submit"]');
    if (submitButton) {
        submitButton.disabled = true;
        submitButton.classList.add('disabled-button');
        submitButton.innerHTML = 'Sales Closed';
    }
    
    // Add a message to inform users
    const form = document.getElementById('payment-form');
    if (form && !document.getElementById('sales-closed-message')) {
        const message = document.createElement('div');
        message.id = 'sales-closed-message';
        message.className = 'alert alert-warning mt-3';
        message.innerHTML = '<i class="fas fa-exclamation-circle me-2"></i> Ticket sales have closed for this draw.';
        form.appendChild(message);
    }
}

function initializeCanvas() {
    const tagsContainer = document.getElementById('tagsContainer');

    TagCanvas.Start("lottery-canvas", 'tagsContainer', {
        textColour: '#ffffff',
        outlineColour: 'transparent',
        initial: [0.02, -0.02],
        maxSpeed: canvasSpeed,
        depth: 0.8,
        dragControl: true,
        wheelZoom: false,
        shuffleTags: true,
        noSelect: true,
        textHeight: 18,
        textFont: 'Poppins, sans-serif',
        fadeIn: 3000
    });

    tagsContainer.remove();
}

function startCountdown(endTime) {
    const timerElement = document.getElementById('countdown-timer');

    const interval = setInterval(async function updateTimer() {
        const now = new Date().getTime();
        const distance = new Date(endTime).getTime() - now;


        // Increase speed when under 5 min
        if (distance <= 5 * 60 * 1000) {
            const canvas = TagCanvas.tc["lottery-canvas"];
            if (canvas) {
                canvas.SetSpeed([0.8, -0.8]);
            }
            // Disable the form elements
            disableLotteryForm();
        }
    
        if (distance <= 0) {
            clearInterval(interval);
            timerElement.innerHTML = "EXPIRED";
    
            const canvas = TagCanvas.tc["lottery-canvas"];
            if (canvas) {
                canvas.SetSpeed([0, 0]);
                canvas.Draw();
            }
    
            if (!isPickingWinner) {
                isPickingWinner = true;
                await pickAndSetWinner();  // ✅ Safe to await now
            }
    
            return;
        }
    
        // Countdown rendering
        const days = Math.floor(distance / (1000 * 60 * 60 * 24));
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((distance % (1000 * 60)) / 1000);
        timerElement.innerHTML = `${days}d ${hours}h ${minutes}m ${seconds}s`;
        
    }, 1000);
    
}

async function fetchWinner(lotteryId) {
    const response = await fetch(`/api/lottery/lotteryGagnant/${lotteryId}`, {
        method: "GET"
    });

    if (!response.ok) {
        // Throw custom error with status for better handling
        const error = new Error("Failed to fetch lottery");
        error.status = response.status;
        throw error;
    }

    return response.json();
}



async function pickAndSetWinner() {
    const lotteryId = getLotteryIdFromURL();

    try {
        const winner = await fetchWinner(lotteryId);

        // Show modal with winner username
        showWinnerModal(winner.winner.name);

    } catch (error) {
        
            console.error("❌ Error picking winner:", error);
    }
}

function showWinnerModal(username) {
    document.getElementById("winnerUsername").textContent = username;
    document.getElementById("winnerModal").style.display = "flex";
}

function closeWinnerModal() {
    const modal = document.getElementById('winnerModal');
    modal.style.animation = 'fadeOut 0.5s ease-out forwards';
    setTimeout(() => {
        modal.style.display = 'none';
        modal.style.animation = 'fadeIn 0.5s ease-out';
    }, 500);
    window.location.href = "/";

}

// Add this to your CSS if you want fadeOut animation
document.head.insertAdjacentHTML('beforeend', '<style>@keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }</style>');


// Calculate total cost
function calculateTotal() {
    const entryCost = parseFloat(document.querySelector('input[name="entrieCost"]').value);
    const quantity = parseInt(document.getElementById('entry-quantity').value);
    const total = entryCost * quantity;
    document.getElementById('total-cost').textContent = `$${total.toFixed(2)}`;
    document.getElementById('total-cost-hidden').value = total.toFixed(2);
}

// Initialize payment form handling
async function initializePaymentForm() {
    if (isInitializing) return;
    isInitializing = true;

    const form = document.getElementById('payment-form');
    const submitButton = form.querySelector('button[type="submit"]');
    
    // Show loading state
    submitButton.disabled = true;
    submitButton.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Initializing...';

    try {
        // Initialize CSRF token first
        await initializeCSRF();
        
        const entryQuantityInput = document.getElementById('entry-quantity');
        const totalCostElement = document.getElementById('total-cost');
        const totalCostHidden = document.getElementById('total-cost-hidden');
        const entryCost = parseFloat(document.querySelector('input[name="entrieCost"]').value);

        function updateTotal() {
            const quantity = parseInt(entryQuantityInput.value);
            const total = quantity * entryCost;
            totalCostElement.textContent = `$${total.toFixed(2)}`;
            totalCostHidden.value = total.toFixed(2);
        }

        function incrementQuantity() {
            const currentValue = parseInt(entryQuantityInput.value);
            if (currentValue < 100) {
                entryQuantityInput.value = currentValue + 1;
                updateTotal();
            }
        }

        function decrementQuantity() {
            const currentValue = parseInt(entryQuantityInput.value);
            if (currentValue > 1) {
                entryQuantityInput.value = currentValue - 1;
                updateTotal();
            }
        }

        // Add event listeners
        entryQuantityInput.addEventListener('input', updateTotal);
        entryQuantityInput.addEventListener('change', function() {
            if (this.value < 1) this.value = 1;
            if (this.value > 100) this.value = 100;
            updateTotal();
        });

        // Handle form submission
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            // Validate form
            const lotteryId = form.querySelector('input[name="lotteryId"]').value;
            const quantity = parseInt(entryQuantityInput.value);
            
            if (!lotteryId) {
                alert('Invalid lottery ID');
                return;
            }
            
            if (isNaN(quantity) || quantity < 1 || quantity > 100) {
                alert('Please enter a valid quantity between 1 and 100');
                return;
            }

            // Validate lottery time
            const lotteryTime = new Date(document.getElementById('lottery-time').dataset.time);
            if (new Date() >= lotteryTime) {
                alert('Lottery sales have closed');
                return;
            }

            submitButton.disabled = true;
            submitButton.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Processing...';

            try {
                // Create payment session using secureFetch
                const response = await secureFetch('/api/lottery/create-payment-session', {
                    method: 'POST',
                    body: JSON.stringify({
                        lotteryId,
                        entryQuantity: quantity
                    })
                });
        
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.message || `Server error: ${response.status}`);
                }
        
                const data = await response.json();
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
                console.error('Error:', error);
                if (error.message.includes('authentification')) {
                    document.getElementById('login-section').style.display = 'block';
                    document.getElementById('payment-form').style.display = 'none';
                } else if (error.message.includes('network')) {
                    alert('Network error. Please check your connection and try again.');
                } else {
                    alert(`Payment Error: ${error.message}`);
                }
            } finally {
                submitButton.disabled = false;
                submitButton.innerHTML = '<span class="fw-bold">Proceed to Payment</span>';
            }
        });

        // Expose increment/decrement functions to window for button clicks
        window.incrementQuantity = incrementQuantity;
        window.decrementQuantity = decrementQuantity;

        // Enable form after initialization
        submitButton.disabled = false;
        submitButton.innerHTML = '<span class="fw-bold">Proceed to Payment</span>';

    } catch (error) {
        console.error('Failed to initialize payment form:', error);
        submitButton.disabled = true;
        submitButton.innerHTML = '<span class="text-danger">Initialization Failed</span>';
        alert('Failed to initialize payment system. Please refresh the page.');
    } finally {
        isInitializing = false;
    }
}

// Initialize everything when the DOM is loaded
document.addEventListener('DOMContentLoaded', async function() {
    try {
        const lotteryTime = new Date(document.getElementById('lottery-time').dataset.time);
        startCountdown(lotteryTime);
        initializeCanvas();
        await initializePaymentForm();
    } catch (error) {
        console.error('Failed to initialize page:', error);
        alert('Failed to initialize page. Please refresh and try again.');
    }
});