module.exports = {
    User: {
        type: 'object',
        properties: {
            userid: { type: 'string', format: 'uuid' },
            username: { type: 'string' },
            age: { type: 'number' },
            email: { type: 'string', format: 'email' },
            created_at: { type: 'string', format: 'date-time' }
        }
    },
    Course: {
        type: 'object',
        properties: {
            id: { type: 'integer' },
            nom: { type: 'string' },
            prix: { type: 'number' },
            niveau: { type: 'string' },
            nombre_heures: { type: 'integer' },
            lessons: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        type: { type: 'string' },
                        url: { type: 'string' }
                    }
                }
            },
            content: { type: 'object' },
            created_at: { type: 'string', format: 'date-time' },
            about: { type: 'string' },
            learning_points: { type: 'array', items: { type: 'string' } },
            program: { type: 'array', items: { type: 'string' } }
        }
    },
    RendezVous: {
        type: 'object',
        properties: {
            id: { type: 'integer' },
            disponibilite_id: { type: 'integer' },
            id_eleve: { type: 'string', format: 'uuid' },
            id_prof: { type: 'string', format: 'uuid' },
            date: { type: 'string', format: 'date' },
            heure: { type: 'string' },
            duree: { type: 'number' },
            payment_id: { type: 'string' }
        }
    },
    Disponibilite: {
        type: 'object',
        properties: {
            id: { type: 'integer' },
            id_prof: { type: 'string', format: 'uuid' },
            start_time: { type: 'string', format: 'date-time' },
            end_time: { type: 'string', format: 'date-time' },
            price: { type: 'number' }
        }
    },
    Error: {
        type: 'object',
        properties: {
            error: { type: 'string' },
            message: { type: 'string' }
        }
    }
};