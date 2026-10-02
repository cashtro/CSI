const express = require('express');
const logger = require('./utils/logger');
const router = express.Router();
const { getRange } = require('./utils/pagination');
const { createClient } = require('@supabase/supabase-js');
const { handleCoursePayment, enrollStudent, handleSubscriptionPayment, confirmSubscription } = require('./utils/stripe');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

const multer = require('multer');
const { authenticateUser, checkAdmin } = require('./utils/auth-middleware');

const storage = multer.memoryStorage();
// Lesson files (video, audio, PDF, images). Anything a browser would run as
// a page when served from the public bucket (HTML, SVG, XML, JS) is refused.
const ACTIVE_CONTENT = /(html|svg|xml|javascript|ecmascript)/i;
const ACTIVE_EXT = /\.(html?|xhtml|svgz?|xml|js|mjs)$/i;
const upload = multer({
    storage,
    limits: {
        fileSize: 50 * 1024 * 1024 //50MB
    },
    fileFilter: (req, file, cb) => {
        if (ACTIVE_CONTENT.test(file.mimetype || '') || ACTIVE_EXT.test(file.originalname || '')) {
            return cb(new Error('Type de fichier non autorisé'), false);
        }
        cb(null, true);
    }
});



router.post('/:course_id/enroll', authenticateUser, handleCoursePayment,  (req, res) => {
    res.status(200)});


router.get('/verify-payment',  enrollStudent, async (req, res) => {   
    //res.status(201).json(res.enrollment);
    res.redirect('/'); })


router.post('/:course_id/subscribe', authenticateUser, handleSubscriptionPayment, (req, res)=>{
    res.status(200)})

router.get('/verify-subsc-payment',  confirmSubscription, async (req, res) => { 
    //res.status(201).json(res.subscription);
    res.redirect('/'); })


const uploadFile = async (courseId, file, accessToken) => {

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY,
        {
            global:{
                headers:{
                    Authorization: `Bearer ${accessToken}`
                }
            }
        }
    )

    const filePath = `lessons/${courseId}/${Date.now()}-${file.originalname}`;
    const { data, error } = await supabase.storage
        .from('course-files')
        .upload(filePath, file.buffer);

    
    if (error) throw error ;
    const { data: { publicUrl },error:URLerror } = supabase.storage
        .from('course-files')
        .getPublicUrl(data.path);

   
    return publicUrl;
};

const trackUploadProgress = (req, res, next) => {
    let loaded = 0;
    const total = req.headers['content-length'];
    
    res.progress = (percent) => {
        res.write(`PROGRESS:${percent}\n`);
    };

    req.on('data', (chunk) => {
        loaded += chunk.length;
        const percent = Math.round((loaded / total) * 100);
        res.progress(percent);
    });

    next();
};

router.get('/test', async (req, res) => {
    const { data } = supabase
        .storage
        .from('dourse-data')
        .getPublicUrl('Anis.jpg')
    res.status(200).json(data);
})


// Modifiez upload.array en upload.fields pour gérer plusieurs types de fichiers
router.post('/add-course', authenticateUser, upload.fields([
    { name: 'courseImage', maxCount: 1 },
    { name: 'files', maxCount: 10 }
    
]), async (req, res) => {
    try {
        const  id_prof  = req.user.id; // Assuming you have a user object in req with the id of the professor
        const accessToken = req.accessToken
        const courseData = req.body;

       

        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_ANON_KEY,
            {
                global: {
                    headers: {
                        Authorization: `Bearer ${accessToken}`
                    }
                }
            }
        );

        let lessons = [];
        let content = null;

        try {
            lessons = courseData.lessons ? JSON.parse(courseData.lessons) : [];
            content = courseData.content ? JSON.parse(courseData.content) : null;
        } catch (parseError) {
            return res.status(400).json({
                error: 'Invalid JSON format in lessons or content',
                field: parseError.message.includes('lessons') ? 'lessons' : 'content'
            });
        }

        // Créer le cours d'abord pour obtenir l'ID
        const { data: course, error: createError } = await supabase
            .from('cours')
            .insert({
                ...courseData, 
                id_prof: id_prof,
                lessons: [], // Leçons vides pour l'instant
                content,
                image_url: null // Champ pour l'URL de l'image
            })
            .select()
            .single();

        if (createError) throw createError;

         // Verficiation de CourseImageURL
        const courseImage = req.files.courseImage ? req.files.courseImage[0] : null;

            let courseImageUrl = null;
            if (courseImage) {
                // Upload the image and get the public URL
                const imageFilePath = `course-images/${course.id}/${Date.now()}-${courseImage.originalname}`;
                const { data: imageData, error: imageError } = await supabase.storage
                    .from('course-files')
                    .upload(imageFilePath, courseImage.buffer);
                if (imageError) throw imageError;
                const { data: { publicUrl } } = supabase.storage
                    .from('course-files')
                    .getPublicUrl(imageData.path);
                courseImageUrl = publicUrl;
            }

        const files = req.files || [];

        //uploading files and update lessons
        let fileIndex = 0;
        let updatedLessons = [];

        try {
            for (const lesson of lessons) {
                if (lesson.type === 'video' || lesson.type === 'pdf' ||
                    lesson.type === 'txt' || lesson.type === 'png') {
                    if (fileIndex < files.length) {
                        lesson.url = await uploadFile(course.id, files[fileIndex], accessToken);
                        fileIndex++;
                    }
                }
                updatedLessons.push(lesson);
            }

            // Mise à jour du cours avec les leçons finales
            const { data: updatedCourse, error: updateError } = await supabase
                .from('cours')
                .update({ 
                    lessons: updatedLessons,
                    // Ne pas écraser l'image_url si déjà définie
                    ...(courseImageUrl && { image_url: courseImageUrl }) 
                })
                .eq('id', course.id)
                .select()
                .single();

            if (updateError) throw updateError;

            res.status(201).json(updatedCourse);
        } catch (uploadError) {
            // Nettoyage si l'upload échoue
            await supabase.from('cours').delete().eq('id', course.id);
            throw uploadError;
        }

    } catch (error) {
        res.status(500).json({
            error: error.message,
            ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
        });
    }
});

//get all course (Admin like)
router.get('/all-courses', async (req, res) => {
    try {
        const { from, to } = getRange(req.query, { defaultLimit: 100, maxLimit: 200 });
        const { data, error } = await supabase
            .from('cours')
            .select(`
                *,
                Users: id_prof (username),
                cours_students (student_id)
            `).order('created_at', { ascending: false }).range(from, to);

        if (error) throw error;

        const enhancedCourses = data.map(course => ({
            ...course,
            student_count: course.cours_students.length, // Count of students enrolled in the course
            prof_name: course.Users?.username || 'Unknown' // Professor's name
        }));

        res.json(enhancedCourses); // Return the enhanced courses
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

//get All courses for a student
router.get('/student-courses/:studentId', authenticateUser, async (req, res) => {
    try {
        const { studentId } = req.params;
        
        const { data, error } = await supabase
            .from('cours_students')
            .select('cours_id')
            .eq('student_id', studentId);

        if (error) throw error;

        const courseIds = data.map(item => item.cours_id); //en gros format {[]} -> []
        
        const { data: courses, error: courseError } = await supabase
            .from('cours')
            .select('*')
            .in('id', courseIds);   //in donne tout where id fait partie de []

        if (courseError) throw courseError;

        res.json(courses);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/course/student-courses-count/:studentId
router.get('/student-courses-count/:studentId', authenticateUser, async (req, res) => {
    try {
        const { count } = await supabase
            .from('cours_students')
            .select('*', { count: 'exact', head: true })
            .eq('student_id', req.params.studentId);

        res.json({ total: count });
    } catch (error) {
        res.status(500).json({ error: 'Échec du comptage' });
    }
});

//get All courses for a teacher
router.get('/professor-courses/:profId', authenticateUser, async (req, res) => {
    try {
        const { profId } = req.params;
        
        const { data, error } = await supabase
            .from('cours')
            .select('*')
            .eq('id_prof', profId);

        if (error) throw error;

        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});






// Update Course
router.put('/update/:id',authenticateUser, upload.array('files'), async (req, res) => {

    const files = req.files
    const accessToken = req.accessToken
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY,
        {
          global: {
            headers: {
              Authorization: `Bearer ${accessToken}`
            }
          }
        }
      )
  

    const {data: existingCourse, error: fetchError} = await supabase
        .from('cours')
        .select('lessons')
        .eq('id',req.params.id)
        
        .single();

    if(fetchError) throw fetchError;

    let updatedLessons = existingCourse.lessons || [];

    if(files && files.length > 0){
        for (const file of files){
            const fileUrl = await uploadFile(req.params.id,file, accessToken);

            updatedLessons.push({
                type: file.mimetype.includes('video') ? 'video' : 'pdf',  //or whatever TODO HANDLE LIKE ADD
                url: fileUrl, //can do , whatever else
                title: file.originalname
            });
        }
    }else{
    }

    try {
        const courseId = req.params.id;
        const accessToken = req.accessToken;
        
        // Récupérer les fichiers séparément
        const files = req.files.files || [];
        const courseImage = req.files.courseImage ? req.files.courseImage[0] : null;
        
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_ANON_KEY,
            {
                global: {
                    headers: {
                        Authorization: `Bearer ${accessToken}`
                    }
                }
            }
        );

        // Récupérer les données existantes du cours
        const { data: existingCourse, error: fetchError } = await supabase
            .from('cours')
            .select('lessons, image_url')
            .eq('id', courseId)
            .single();

        if (fetchError) throw fetchError;

        let updatedLessons = existingCourse.lessons || [];
        let imageUrl = existingCourse.image_url; // Conserver l'image actuelle par défaut

        // Traiter l'upload de la nouvelle image de profil
        if (courseImage) {
            try {
                // Utiliser un sous-dossier spécifique pour les images de cours
                const imageFilePath = `course-images/${courseId}/${Date.now()}-${courseImage.originalname}`;
                
                // Upload de l'image
                const { data: imageData, error: imageError } = await supabase.storage
                    .from('course-files')
                    .upload(imageFilePath, courseImage.buffer);

                if (imageError) throw imageError;

                // Obtenir l'URL publique
                const { data: { publicUrl } } = supabase.storage
                    .from('course-files')
                    .getPublicUrl(imageData.path);

                imageUrl = publicUrl;
            } catch (imageError) {
                logger.error("Erreur lors de l'upload de l'image:", imageError);
                // Continuer même en cas d'erreur d'upload d'image
            }
        }

        // Traiter les fichiers de leçons (code existant)
        if (files && files.length > 0) {
            for (const file of files) {
                const fileUrl = await uploadFile(courseId, file, accessToken);

                updatedLessons.push({
                    type: file.mimetype.includes('video') ? 'video' : 
                          file.mimetype.includes('pdf') ? 'pdf' :
                          file.mimetype.includes('text') ? 'txt' :
                          file.mimetype.includes('image') ? 'png' : 'other',
                    url: fileUrl,
                    title: file.originalname
                });
            }
        } else {
            // logger.info('Aucun fichier de leçon téléchargé pour cette mise à jour');
        }

        // Mettre à jour le cours avec les nouvelles données
        const updateData = {
            ...req.body,
            lessons: updatedLessons
        };
        
        // Ajouter l'URL de l'image uniquement si une nouvelle image a été téléchargée
        if (courseImage) {
            updateData.image_url = imageUrl;
        }

        const { data, error } = await supabase
            .from('cours')
            .update(updateData)
            .eq('id', courseId)
            .single();

        if (error) throw error;
        
        res.json(data);
    } catch (error) {
        logger.error('Erreur de mise à jour:', error);
        res.status(500).json({ error: error.message });
    }
});
// Delete Course
router.delete('/:id',checkAdmin, async (req, res) => {
    //isadmin? so can do, if not rep bad
    const accessToken = req.accessToken
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY,
        {
          global: {
            headers: {
              Authorization: `Bearer ${accessToken}`
            }
          }
        }
      )
  
    try {
        await supabase.storage
            .from('course-files')
            .remove([`lessons/${req.params.id}`]);
            
        const { error } = await supabase
            .from('cours')
            .delete()
            .eq('id', req.params.id);

        if (error) throw error;
        res.status(204).end();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


router.get('/course-details/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const { data: course, error } = await supabase
            .from('cours')
            .select('*, Users: id_prof(username), cours_students: cours_students (student_id)')
            .eq('id', id)
            .single();

        if (error?.code === 'PGRST116') { 
            return res.status(404).json({ error: 'Course not found' });
        }
        if (error) throw error;

        /* dont think its needed but who knows
        const enhancedLessons = course.lessons.map(lesson => {
            if (!lesson.url) return lesson;
            
            // Extract path from stored URL
            const pathParts = lesson.url.split('/');
            const bucketIndex = pathParts.indexOf('course-files');
            const filePath = pathParts.slice(bucketIndex + 1).join('/');

            // Generate fresh URL
            const { data: { publicUrl } } = supabase.storage
                .from('course-files')
                .getPublicUrl(filePath);

            return { ...lesson, url: publicUrl };
        });

        // 3. Combine with other course data
        const enhancedCourse = {
            ...course,
            lessons: enhancedLessons
        };*/

        //new V of enhancedCourse
        const enhancedCourse = {
            ...course,
            student_count: course.cours_students.length,
            professor: course.Users?.username || 'Unknown'
        };

        res.json(enhancedCourse); //enhancedCourse was course

    } catch (error) {
        res.status(500).json({
            error: error.message,
            ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
        });
    }
});


                            //was checkAdmin
router.get('/total-courses', authenticateUser, async (req, res) => {

    try {
        const { data, count, error } = await supabase
            .from('cours')
            .select('*', { count: 'exact' , head:true});

        if (error) {
            logger.error("ERREUR Supabase détaillée:", {
                message: error.message,
                code: error.code,
                details: error.details
            });
            throw error;
        }

        res.json({ total: count });

    } catch (error) {
        logger.error("ERREUR COMPLETE:", {
            name: error.name,
            message: error.message,
            stack: error.stack
        });
        res.status(500).json({ error: "Échec du comptage" });
    }
});

// Nouvelle route pour le nombre de cours de l'étudiant connecté TEST
router.get('/my-courses', authenticateUser, async (req, res) => {
    try {
        const studentId = req.user.id; // ID récupéré du token JWT

        // 1. Récupération des IDs de cours
        const { data, error } = await supabase
            .from('cours_students')
            .select('cours_id')
            .eq('student_id', studentId);

        if (error) throw error;

        // 2. Comptage direct dans la requête
        const { count, error: countError } = await supabase
            .from('cours_students')
            .select('*', { count: 'exact', head: true })
            .eq('student_id', studentId);

        if (countError) throw countError;

        res.json({ total: count });

    } catch (error) {
        logger.error('Erreur détaillée:', error);
        res.status(500).json({ error: 'Impossible de récupérer les cours' });
    }
});






//


// Get all lesson progress records (admin view)
router.get('/lesson-progress', checkAdmin,  async (req, res) => {
    const accessToken = req.accessToken
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY,
        {
          global: {
            headers: {
              Authorization: `Bearer ${accessToken}`
            }
          }
        }
      )
  

    try {
        const { data, error } = await supabase
            .from('LessonProgress')
            .select(`
                *,
                Users: student_id (username),
                cours: course_id (title)
            `)
            .order('created_at', { ascending: false });

        if (error) throw error;

        const enhancedProgress = data.map(progress => ({
            ...progress,
            student_name: progress.Users?.username || 'Unknown',
            course_title: progress.cours?.title || 'Unknown'
        }));

        res.json(enhancedProgress);
    } catch (error) {
        res.status(500).json({ 
            error: error.message,
            ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
        });
    }
});

// Get progress for a specific student and course
router.get('/progress/:student_id/:course_id', authenticateUser, async (req, res) => {
    const accessToken = req.accessToken
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY,
        {
          global: {
            headers: {
              Authorization: `Bearer ${accessToken}`
            }
          }
        }
      )
  
    try {
        const { student_id, course_id } = req.params;
        
        // Check if user is admin or the student themselves
        if (req.user.role !== 'admin' && req.user.id !== student_id) {
            return res.status(403).json({ error: 'Unauthorized access to progress data' });
        }

        const { data, error } = await supabase
            .from('LessonProgress')
            .select('*')
            .eq('student_id', student_id)
            .eq('course_id', course_id)
            .single();

        if (error && error.code !== 'PGRST116') throw error;
        
        // If no progress record exists, create one with 0 progress
        if (error && error.code === 'PGRST116') {
            const { data: courseData, error: courseError } = await supabase
                .from('cours')
                .select('title')
                .eq('id', course_id)
                .single();
                
            if (courseError) throw courseError;
            
            const { data: userData, error: userError } = await supabase
                .from('Users')
                .select('username')
                .eq('id', student_id)
                .single();
                
            if (userError) throw userError;
            
            return res.json({
                student_id,
                course_id,
                amount_completed: 0,
                student_name: userData.username,
                course_title: courseData.title
            });
        }
        
        // Get student and course names
        const { data: userData, error: userError } = await supabase
            .from('Users')
            .select('username')
            .eq('id', data.student_id)
            .single();
            
        if (userError) throw userError;
        
        const { data: courseData, error: courseError } = await supabase
            .from('cours')
            .select('title')
            .eq('id', data.course_id)
            .single();
            
        if (courseError) throw courseError;
        
        const enhancedProgress = {
            ...data,
            student_name: userData.username,
            course_title: courseData.title
        };

        res.json(enhancedProgress);
    } catch (error) {
        res.status(500).json({
            error: error.message,
            ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
        });
    }
});

// Update lesson progress
router.put('/update-progress/:student_id/:course_id', authenticateUser, async (req, res) => {
    const accessToken = req.accessToken

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY,
        {
          global: {
            headers: {
              Authorization: `Bearer ${accessToken}`
            }
          }
        }
      )
  
    try {
        const { student_id, course_id } = req.params;
        const { amount_completed } = req.body;
        
        // Validate input
        if (amount_completed < 0 || amount_completed > 1) {
            return res.status(400).json({ error: 'Amount completed must be between 0 and 1' });
        }
        
        // Check if user is authorized (admin or the student themselves)
        if (req.user.role !== 'admin' && req.user.id !== student_id) {
            return res.status(403).json({ error: 'Unauthorized to update progress' });
        }
        
        // Check if progress record exists
        const { data: existingProgress, error: checkError } = await supabase
            .from('LessonProgress')
            .select('id')
            .eq('student_id', student_id)
            .eq('course_id', course_id)
            .single();
            
        if (checkError && checkError.code !== 'PGRST116') throw checkError;
        
        let result;
        
        // Update existing record or create new one
        if (existingProgress) {
            const { data, error } = await supabase
                .from('LessonProgress')
                .update({ amount_completed })
                .eq('id', existingProgress.id)
                .select()
                .single();
                
            if (error) throw error;
            result = data;
        } else {
            const { data, error } = await supabase
                .from('LessonProgress')
                .insert({ 
                    student_id,
                    course_id,
                    amount_completed 
                })
                .select()
                .single();
                
            if (error) throw error;
            result = data;
        }
        
        res.json(result);
    } catch (error) {
        res.status(500).json({
            error: error.message,
            ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
        });
    }
});

// Reset progress
router.delete('/reset-progress/:id', authenticateUser, checkAdmin, async (req, res) => {

    const accessToken = req.accessToken
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY,
        {
          global: {
            headers: {
              Authorization: `Bearer ${accessToken}`
            }
          }
        }
      )
  
    try {
        const { id } = req.params;
        
        const { error } = await supabase
            .from('LessonProgress')
            .update({ amount_completed: 0 })
            .eq('id', id);
            
        if (error) throw error;
        
        res.status(200).json({ message: 'Progress reset successfully' });
    } catch (error) {
        res.status(500).json({
            error: error.message,
            ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
        });
    }
});

// Get all progress records for a student
router.get('/student-progress/:student_id', authenticateUser, async (req, res) => {

    const accessToken = req.accessToken
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY,
        {
          global: {
            headers: {
              Authorization: `Bearer ${accessToken}`
            }
          }
        }
      )
  
    try {
        const { student_id } = req.params;
        
        // Check if user is authorized (admin or the student themselves)
        if (req.user.role !== 'admin' && req.user.id !== student_id) {
            return res.status(403).json({ error: 'Unauthorized access to progress data' });
        }
        
        const { data, error } = await supabase
            .from('LessonProgress')
            .select(`
                *,
                cours: course_id (nom)
            `)
            .eq('student_id', student_id);
            
        if (error) throw error;
        
        // Read the field we actually selected (`nom`). Previously this read
        // `.title` (never selected) so course_title was always 'Unknown'.
        const enhancedProgress = data.map(progress => ({
            ...progress,
            course_title: progress.cours?.nom || 'Unknown'
        }));
        
        res.json(enhancedProgress);
    } catch (error) {
        logger.error('Error fetching student progress:', error);
        res.status(500).json({
            error: error.message,
            ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
        });
    }
});

module.exports = router;