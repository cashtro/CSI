async function fetchTotalCourses() {
    const totalElement = document.getElementById('totalCourses');
    const chartProgress = document.querySelector('.chart-progress');
    const percentageElement = document.querySelector('.circle-chart-percentage');

    try {
        // 1. Configuration de la requête
        const token = localStorage.getItem('accessToken') || sessionStorage.getItem("accessToken"); 
        

        // 2. Appel à l'API
        const response = await fetch('/api/course/total-courses', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
              },
            credentials: 'include' // Si vous utilisez des cookies
        });

        // 3. Vérification de la réponse
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Erreur HTTP ${response.status}`);
        }

        // 4. Traitement des données
        const data = await response.json();
        const total = data.total || 0; 
        
        if (typeof total !== 'number') {
            throw new Error('Format de réponse invalide');
        }

        // 5. Mise à jour de l'UI
        totalElement.textContent = total >= 1000 
            ? `${(total/1000).toFixed(1)}K` 
            : total;

        // 6. Mise à jour du graphique (si applicable)
        if (typeof updateCircleChart === 'function') {
            updateCircleChart(total);
        }

        // 1. Calcul dynamique du maximum (arrondi à la centaine supérieure)
        const maxCourses = Math.ceil(total / 100) * 100 || 100;

        // 2. Calcul du pourcentage
        const percentage = (total / maxCourses) * 100;

        // 3. Mise à jour du graphique
        chartProgress.style.strokeDasharray = `${percentage}, 100`;
        percentageElement.textContent = `${Math.round(percentage)}%`;

    } catch (error) {
        console.error('Erreur:', error);
        totalElement.textContent = 'Error';
        totalElement.style.color = '#ff4444';
        
        // Affichage temporaire du message d'erreur
        const errorDisplay = document.createElement('small');
        errorDisplay.textContent = ` (${error.message})`;
        errorDisplay.style.color = '#ff4444';
        errorDisplay.style.fontSize = '0.8em';
        totalElement.insertAdjacentElement('afterend', errorDisplay);
        
        // Suppression après 5 secondes
        setTimeout(() => errorDisplay.remove(), 5000);
    }
}


async function fetchTotalTickets() {
    const totalElement = document.getElementById('totalTickets');
    if (!totalElement) return;

    try {
        // 1. Configuration de la requête
        const token = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken');
        
        // 2. Appel à l'API
        const response = await fetch('/api/lotteryUserData', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            },
            credentials: 'include'
        });

        // 3. Vérification de la réponse
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || `Erreur HTTP ${response.status}`);
        }

        // 4. Traitement des données
        const contentType = response.headers.get('content-type');
        if (!contentType?.includes('application/json')) {
            throw new Error('Format de réponse non-JSON');
        }

        const data = await response.json();
        const total = Array.isArray(data) 
            ? data.reduce((sum, lottery) => sum + (lottery.userEntries || 0), 0)
            : 0;

        // 5. Mise à jour de l'UI
        totalElement.textContent = total >= 1000 
            ? `${(total/1000).toFixed(1)}K` 
            : total;

        // 6. Mise à jour du graphique (si applicable)
        if (typeof updateCircleChart === 'function') {
            updateCircleChart(total);
        }

    } catch (error) {
        console.error('Erreur:', error);
        totalElement.textContent = 'Erreur';
        totalElement.style.color = '#ff4444';
        
        // Affichage temporaire du message d'erreur
        const errorDisplay = document.createElement('small');
        errorDisplay.textContent = ` (${error.message})`;
        errorDisplay.style.color = '#ff4444';
        errorDisplay.style.fontSize = '0.8em';
        totalElement.insertAdjacentElement('afterend', errorDisplay);
        
        // Suppression après 5 secondes
        setTimeout(() => errorDisplay.remove(), 5000);
    }
}


// Initialisation
document.addEventListener('DOMContentLoaded', () => {
    fetchTotalCourses();
    setInterval(fetchTotalCourses, 5 * 60 * 1000); // Rafraîchissement toutes les 5 minutes
});