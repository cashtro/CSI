// Fonction pour calculer le temps restant
function getTimeRemaining(endTime) {
    const end = new Date(endTime);
    const now = new Date();
    const diff = end - now;
  
    if (diff <= 0) return { ended: true };
  
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const minutes = Math.floor((diff / (1000 * 60)) % 60);
    const seconds = Math.floor((diff / 1000) % 60);
  
    return {
        ended: false,
        days: days.toString().padStart(2, '0'),
        hours: hours.toString().padStart(2, '0'),
        minutes: minutes.toString().padStart(2, '0'),
        seconds: seconds.toString().padStart(2, '0')
    };
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
  
  document.addEventListener('DOMContentLoaded', async () => {
    const container = document.getElementById('lottery-container');
  
    try {
        const lotteries = JSON.parse(window.lotteries);
  
        if (!Array.isArray(lotteries)) throw new Error("Invalid data");
  
        container.innerHTML = lotteries.map((lottery, index) => `
            <div class="parent">
                <div class="card">
                    <div class="content-box">
                        <img src="${window.safeUrl(lottery.imageProduit)}" alt="${window.escapeHtml(lottery.nomProduit)}" class="product-image" />
                        <span class="card-title">${window.escapeHtml(lottery.nomProduit)}</span>
                        <a href="#" class="buy-entries-btn" id="buy-entries-${window.escapeHtml(lottery.lotteryId)}" data-lottery-id="${window.escapeHtml(lottery.lotteryId)}">Buy entries</a>
                    </div>
   
                    <div class="date-box" id="timer-container-${window.escapeHtml(lottery.lotteryId)}">
                        <div class="time-unit">
                            <span class="time-value" id="days-${window.escapeHtml(lottery.lotteryId)}">00</span>
                            <span class="time-label">jours</span>
                        </div>
                        <div class="time-unit">
                            <span class="time-value" id="hours-${window.escapeHtml(lottery.lotteryId)}">00</span>
                            <span class="time-label">heures</span>
                        </div>
                        <div class="time-unit">
                            <span class="time-value" id="minutes-${window.escapeHtml(lottery.lotteryId)}">00</span>
                            <span class="time-label">min</span>
                        </div>
                        <div class="time-unit">
                            <span class="time-value" id="seconds-${window.escapeHtml(lottery.lotteryId)}">00</span>
                            <span class="time-label">sec</span>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
  
        // Lancement des timers
        lotteries.forEach(lottery => {
            const interval = setInterval(() => {
                const time = getTimeRemaining(lottery.lotteryTime);
                const timerContainer = document.getElementById(`timer-container-${lottery.lotteryId}`);
  
                if (time.ended) {
                    timerContainer.innerHTML = '<span style="font-weight:bold;color:#ff0000;">TERMINÉ</span>';
                    clearInterval(interval);
                } else {
                    document.getElementById(`days-${lottery.lotteryId}`).textContent = time.days;
                    document.getElementById(`hours-${lottery.lotteryId}`).textContent = time.hours;
                    document.getElementById(`minutes-${lottery.lotteryId}`).textContent = time.minutes;
                    document.getElementById(`seconds-${lottery.lotteryId}`).textContent = time.seconds;
                }
            }, 1000);
        });
        
        // Ajouter les écouteurs d'événements pour les boutons "Buy entries"
        document.querySelectorAll('.buy-entries-btn').forEach(button => {
            button.addEventListener('click', async function(event) {
                event.preventDefault();
                const lotteryId = this.getAttribute('data-lottery-id');
                
                // Vérifier si l'utilisateur est connecté
                const isAuthenticated = await checkUserAuthentication();
                
                if (isAuthenticated) {
                    // L'utilisateur est déjà connecté, rediriger vers la page d'achat
                    window.location.href = `/Purchase-Lottery-Tickets?lotteryId=${lotteryId}`;
                } else {
                    // L'utilisateur n'est pas connecté, rediriger vers la page de connexion
                    // avec paramètre de redirection vers la page d'achat
                    const returnUrl = `/Purchase-Lottery-Tickets?lotteryId=${lotteryId}`;
                    window.location.href = `/login?redirect=${encodeURIComponent(returnUrl)}`;
                }
            });
        });
  
    } catch (err) {
        console.error("Erreur de récupération des données :", err);
        container.innerHTML = "<p>Erreur lors du chargement des loteries.</p>";
    }
  });