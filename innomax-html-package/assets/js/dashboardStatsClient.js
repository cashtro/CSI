// Client

async function fetchStudentCoursesCount(studentId) {
    const totalElement = document.getElementById('totalCourse');
    const chartProgress = document.querySelector('.chart-progress');
    const percentageElement = document.querySelector('.circle-chart-percentage');

    try {
        // 1. Authentification
        const token = localStorage.getItem('accessToken') || sessionStorage.getItem("accessToken"); 
        

        // 2. Appel API
        //const response = await fetch(`/api/course/student-courses-count/${studentId}`, {
        //    method: 'GET',
        //    headers: {
        //        'Authorization': `Bearer ${token}`
        //    },
        //    credentials: 'include'
        //});

        // 3. Gestion des erreurs HTTP
/*        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Erreur serveur');
        }*/

        const [studentCourses, totalCourses] = await Promise.all([
            fetch(`/api/course/student-courses-count/${studentId}`, { 
                headers: {'Authorization': `Bearer ${token}`}
            }),
            fetch('/api/course/total-courses', {
                headers: {'Authorization': `Bearer ${token}`}
            })
        ]);
        if (!studentCourses.ok || !totalCourses.ok) {
            throw new Error('Erreur de récupération des données');
        }

        const studentData = await studentCourses.json();
        const totalData = await totalCourses.json();

        const studentCount = studentData.total || 0;
        const totalCount = totalData.total || 1; // Éviter la division par zéro

        document.getElementById('totalCoursesCount').textContent = `(${totalCount})`
        // Calcul du pourcentage
        const percentage = (studentCount / totalCount) * 100;

        // Mise à jour du graphique
        chartProgress.style.strokeDasharray = `${percentage}, 100`;
        percentageElement.textContent = `${Math.round(percentage)}%`;

        const linkElement = document.getElementById('coursesLink');
        linkElement.innerHTML = `
            <a href="/all-courses" style="color: inherit; text-decoration: none;">
                ${Math.round(percentage)}% of ${totalCount} courses
            </a>
        `;

        // Si 0%, ajouter un message spécial
        if (percentage === 0) {
            linkElement.innerHTML += `<br><small style="font-size: 0.8em;">Start your learning journey!</small>`;
        }
        

        // 4. Traitement des données
       
        const data =studentData;
        const total = data.total || 0;

        // 5. Mise à jour UI
        totalElement.textContent = total;
        
        // 6. Calcul pour le graphique
        //const max = Math.ceil(total / 5) * 5 || 5; // Échelle par paliers de 5
        //const percentage = (total / max) * 100;
        
        //chartProgress.style.strokeDasharray = `${percentage}, 100`;
        //percentageElement.textContent = `${Math.round(percentage)}%`;

        return total;

    } catch (error) {
        console.error('Erreur:', error);
        totalElement.textContent = 'Err';
        totalElement.style.color = '#ff4444';
        
        // Message d'erreur temporaire
        const errorElement = document.createElement('small');
        errorElement.textContent = ` (${error.message})`;
        errorElement.style.color = 'inherit';
        totalElement.appendChild(errorElement);
        
        setTimeout(() => errorElement.remove(), 5000);
        
        throw error;
    }
}

async function fetchTotalAppointments() {
    const totalElement = document.getElementById('totalAppointment');

    try {
        // 1. Configuration de la requête
        const token = localStorage.getItem('accessToken') || sessionStorage.getItem("accessToken"); 
        

        // 2. Appel à l'API
        const response = await fetch('/api/rdv/total-rdv', {
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

        totalElement.textContent = total;

    } catch (error) {
        console.error('Erreur:', error);
        totalElement.textContent = 'Error';
        totalElement.style.color = '#ff4444';
        
    }
}

async function fetchAppointmentsData() {
    try {
        const token = localStorage.getItem('accessToken') || sessionStorage.getItem("accessToken"); 
        const response = await fetch('/api/rdv/monthly-appointments', {headers: {'Authorization': `Bearer ${token}`}});
        const data = await response.json();
        
        // Exemple de données : { "jan":5, "feb":8, ... }
        const points = Object.values(data);
        const svgPath = generateWavePath(points);
        
        document.querySelector('.appointments-chart path').setAttribute('d', svgPath);
    } catch (error) {
        console.error('Erreur rendez-vous:', error);
    }
}

// Helper pour générer le chemin SVG
function generateWavePath(dataPoints) {
    if (dataPoints.length === 0 || Math.max(...dataPoints) === 0) {
        // Valeurs par défaut pour une ligne plate
        return "M0,50 L500,50";
    }
    
    const max = Math.max(...dataPoints);
    return dataPoints.map((val, i) => {
        const x = (i / (dataPoints.length - 1)) * 500;
        const y = 100 - (val / max) * 80; // Réduire l'amplitude pour éviter les pics
        return `${x},${y}`;
    }).join(' L');
}

// Initialisation
document.addEventListener('DOMContentLoaded', async () => {

    const validationResponse = await fetch(`/api/auth/validateToken`, {
        headers: {
            'Authorization': `Bearer ${localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken')}`,
        }
    });

    if (!validationResponse.ok) {
        throw new Error('Token invalide ou expiré');
    }

    const { success, userid, error } = await validationResponse.json();
    
    if (!success || !userid) {
        throw new Error(error || 'Échec de l\'authentification');
    }


    await fetchStudentCoursesCount(userid);
    await fetchTotalAppointments();
    await fetchAppointmentsData();
    setInterval(async ()=>{await fetchStudentCoursesCount(userid); await fetchAppointmentsData();} , 300000); // 5 minutes
});