function openCourseSummaryModal(courseId) {
    // Créer le modal s'il n'existe pas déjà
    let summaryModal = document.querySelector('.course-summary-modal');
    if (!summaryModal) {
        summaryModal = document.createElement('div');
        summaryModal.classList.add('course-summary-modal');
        summaryModal.style.cssText = `
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
            opacity: 0;
            transition: opacity 0.3s ease;
        `;
        
        summaryModal.innerHTML = `
            <div class="modal-content" style="
                background-color: white;
                border-radius: 8px;
                width: 90%;
                max-width: 1300px;
                max-height: 100vh;
                overflow-y: auto;
                padding: 2rem;
                position: relative;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
                transform: translateY(20px);
                transition: transform 0.3s ease;
            ">
                <div class="modal-header" style="
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 1.5rem;
                    padding-bottom: 1rem;
                    border-bottom: 1px solid #eee;
                ">
                    <h2 id="course-summary-title" style="
                        margin: 0;
                        color: #333;
                        font-size: 1.5rem;
                    ">Course summary</h2>
                    <button class="close-modal" style="
                        background: none;
                        border: none;
                        font-size: 1.5rem;
                        cursor: pointer;
                        color: #777;
                    ">×</button>
                </div>
                
                <div id="course-summary-content" style="margin-bottom: 1.5rem;">
                    <div class="loading-spinner">
                        <div style="
                            width: 40px;
                            height: 40px;
                            border: 4px solid #f3f3f3;
                            border-top: 4px solid #3498db;
                            border-radius: 50%;
                            animation: spin 1s linear infinite;
                        "></div>
                    </div>
                </div>
                
                <div class="modal-footer" style="
                    display: flex;
                    justify-content: flex-end;
                    gap: 1rem;
                    padding-top: 1rem;
                    border-top: 1px solid #eee;
                ">                   
                    <button class="cancel-btn" style="
                        padding: 0.75rem 1.5rem;
                        background-color: #f1f1f1;
                        color: #333;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-weight: 500;
                    ">Close</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(summaryModal);
        
        // Fermer le modal
        const closeBtn = summaryModal.querySelector('.close-modal');
        const cancelBtn = summaryModal.querySelector('.cancel-btn');
        
        closeBtn.addEventListener('click', () => {
            closeSummaryModal(summaryModal);
        });
        
        cancelBtn.addEventListener('click', () => {
            closeSummaryModal(summaryModal);
        });
              
    }
    
    // Afficher le modal avec animation
    summaryModal.style.display = 'flex';
    setTimeout(() => {
        summaryModal.style.opacity = '1';
        summaryModal.querySelector('.modal-content').style.transform = 'translateY(0)';
    }, 10);
    
    // Charger les informations sommaires du cours
    fetchCourseSummary(courseId);
}

function closeSummaryModal(modal) {
    // Mettre en pause toutes les vidéos dans la modal
    const videos = modal.querySelectorAll('video');
    videos.forEach(video => {
        video.pause();
    });

    // Animation de fermeture
    modal.style.opacity = '0';
    modal.querySelector('.modal-content').style.transform = 'translateY(20px)';
    
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
}

async function fetchCourseSummary(courseId) {
    const summaryContent = document.getElementById('course-summary-content');
    summaryContent.innerHTML = '<div style="text-align: center; padding: 1rem;">Chargement en cours...</div>';

    try {
        const response = await fetch(`/api/course/course-details/${courseId}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
            }
        });
        
        if (!response.ok) throw new Error('Erreur lors du chargement du cours');
        
        const course = await response.json();
        
        // Mettre à jour le titre
        document.getElementById('course-summary-title').textContent = course.nom || 'Résumé du cours';
        
        // Vérifier s'il y a des leçons
        const hasLessons = course.lessons && course.lessons.length > 0;

        // HTML pour la section principale
        let mainContentHTML = '';
        
        if (hasLessons) {
            // Section avec liste des leçons à gauche et affichage à droite
            mainContentHTML = `
                <div style="display: flex; gap: 1.5rem;">
                    <!-- Lesson list -->
                    <div style="width: 250px; border-right: 1px solid #eee; padding-right: 1rem;">
                        <h3 style="margin: 0 0 1rem 0; font-size: 1.1rem; color: #333;">
                            Lessons (${course.lessons.length})
                        </h3>
                        <div style="display: flex; flex-direction: column; gap: 0.5rem; max-height: 60vh; overflow-y: auto;">
                            ${course.lessons.map((lesson, index) => `
                                <button class="lesson-btn" data-index="${index}" style="
                                    padding: 0.75rem;
                                    text-align: left;
                                    border: none;
                                    background: ${index === 0 ? '#e3f2fd' : '#f8f9fa'};
                                    border-radius: 6px;
                                    cursor: pointer;
                                    transition: background 0.2s;
                                ">
                                    <div style="font-weight: 500; color: #212529;">
                                        ${window.escapeHtml(lesson.title || `Leçon ${index + 1}`)}
                                    </div>
                                    <div style="font-size: 0.8rem; color: #6c757d; margin-top: 0.25rem;">
                                        Type: ${window.escapeHtml(lesson.type || 'Non spécifié')}
                                    </div>
                                </button>
                            `).join('')}
                        </div>
                    </div>
                    
                    <!-- All lessons -->
                    <div style="flex-grow: 1;">
                        ${renderLessonContent(course.lessons[0])}
                    </div>
                </div>
            `;
        } else {
            // Placeholder quand il n'y a pas de leçons
            mainContentHTML = `
                <div style="
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100%;
                    text-align: center;
                    padding: 2rem;
                ">
                    <h3 style="margin: 0 0 1rem 0; font-size: 1.2rem; color: #333;">
                        Aucune leçon disponible pour ce cours
                    </h3>
                    
                    <div style="
                        width: 100%;
                        max-width: 600px;
                        background: #000;
                        border-radius: 8px;
                        overflow: hidden;
                        margin-bottom: 1rem;
                    ">
                        <!-- Placeholder vidéo -->
                        <video controls style="width: 100%; height: 300px; background: #000;">
                            <source src="https://www.videoplaceholder.com/video.mp4" type="video/mp4">
                            Votre navigateur ne supporte pas les vidéos HTML5.
                        </video>
                    </div>
                    
                    <p style="color: #666; max-width: 600px;">
                        Le contenu de ce cours sera bientôt disponible. Voici une vidéo d'introduction.
                    </p>
                </div>
            `;
        }

        // HTML complet
        const summaryHTML = `
            <div>
                ${mainContentHTML}   
                
                
            </div>
            
        `;
        
        summaryContent.innerHTML = summaryHTML;

        // Ajouter les événements pour les boutons de leçon si elles existent
        if (hasLessons) {
            document.querySelectorAll('.lesson-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    const index = this.getAttribute('data-index');
                    const lesson = course.lessons[index];
                    
                    // Mettre à jour le style des boutons
                    document.querySelectorAll('.lesson-btn').forEach(b => {
                        b.style.background = '#f8f9fa';
                    });
                    this.style.background = '#e3f2fd';
                    
                    // Mettre à jour l'affichage de la leçon
                    const lessonDisplay = document.querySelector('.lesson-display');
                    if (lessonDisplay) {
                        lessonDisplay.innerHTML = renderLessonContent(lesson);
                    }
                });
            });
        }

    } catch (error) {
        console.error('Erreur:', error);
        summaryContent.innerHTML = `
            <div style="color: #dc3545; text-align: center; padding: 1.5rem;">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" style="margin-bottom: 0.5rem;">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <p>Impossible de charger les détails du cours</p>
                <p style="font-size: 0.9rem; margin-top: 0.5rem;">${window.escapeHtml(error.message)}</p>
            </div>
        `;
    }
}

// Fonction pour afficher le contenu d'une leçon
function renderLessonContent(lesson) {
    if (!lesson) return '<p style="color: #666;">Aucune leçon sélectionnée</p>';
    
    if (lesson.type === 'video') {
        return `
            <div class="lesson-display">
                <h3 style="margin: 0 0 1rem 0; font-size: 1.3rem; color: #333;">
                    ${window.escapeHtml(lesson.title || 'Lesson without title')}
                </h3>
                <div style="background: #000; border-radius: 8px; overflow: hidden; margin-bottom: 1rem;">
                    <video controls style="width: 100%;">
                        <source src="${window.safeUrl(lesson.url)}" type="video/mp4">
                        Votre navigateur ne supporte pas les vidéos HTML5.
                    </video>
                </div>
                ${lesson.url ? `
                    <a href="${window.safeUrl(lesson.url)}" target="_blank" style="
                        display: inline-flex;
                        align-items: center;
                        gap: 0.5rem;
                        color: #0d6efd;
                        text-decoration: none;
                    ">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                            <polyline points="15 3 21 3 21 9"></polyline>
                            <line x1="10" y1="14" x2="21" y2="3"></line>
                        </svg>
                        Open video in a new tab
                    </a>
                ` : ''}
            </div>
        `;
    } else if (lesson.type === 'pdf') {
        return `
            <div class="lesson-display">
                <h3 style="margin: 0 0 1rem 0; font-size: 1.3rem; color: #333;">
                    ${window.escapeHtml(lesson.title || 'Leçon sans titre')}
                </h3>
                <div style="height: 500px; border: 1px solid #eee; border-radius: 8px; margin-bottom: 1rem;">
                    <iframe src="${window.safeUrl(lesson.url)}" style="width: 100%; height: 100%; border: none;"></iframe>
                </div>
                ${lesson.url ? `
                    <a href="${window.safeUrl(lesson.url)}" target="_blank" style="
                        display: inline-flex;
                        align-items: center;
                        gap: 0.5rem;
                        color: #0d6efd;
                        text-decoration: none;
                    ">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                            <polyline points="15 3 21 3 21 9"></polyline>
                            <line x1="10" y1="14" x2="21" y2="3"></line>
                        </svg>
                        Open PDF in a new tab
                    </a>
                ` : ''}
            </div>
        `;
    } else {
        return `
            <div class="lesson-display">
                <h3 style="margin: 0 0 1rem 0; font-size: 1.3rem; color: #333;">
                    ${window.escapeHtml(lesson.title || 'Lesson without title')}
                </h3>
                <div style="padding: 2rem; background: #f8f9fa; border-radius: 8px; text-align: center;">
                    <p style="color: #666; margin-bottom: 1rem;">
                        Type: ${window.escapeHtml(lesson.type || 'Not specified')}
                    </p>
                    ${lesson.url ? `
                        <a href="${window.safeUrl(lesson.url)}" target="_blank" style="
                            display: inline-flex;
                            align-items: center;
                            gap: 0.5rem;
                            color: #0d6efd;
                            text-decoration: none;
                        ">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                                <polyline points="15 3 21 3 21 9"></polyline>
                                <line x1="10" y1="14" x2="21" y2="3"></line>
                            </svg>
                            Access content
                        </a>
                    ` : '<p style="color: #666;">No content</p>'}
                </div>
            </div>
        `;
    }
}