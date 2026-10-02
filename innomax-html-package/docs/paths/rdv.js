module.exports = {
    '/rdv/create': {
        post: {
            tags: ['Rendez-vous'],
            summary: 'Create new appointment',
            security: [{ bearerAuth: [] }],
            requestBody: {
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                disponibilite_id: { type: 'string' },
                                id_eleve: { type: 'string', format: 'uuid' }
                            },
                            required: ['disponibilite_id', 'id_eleve']
                        }
                    }
                }
            },
            responses: {
                201: { $ref: '#/components/schemas/RendezVous' },
                400: { $ref: '#/components/responses/400Error' }
            }
        }
    },
    '/rdv/all': {
        get: {
            tags: ['Rendez-vous'],
            summary: 'Get user appointments',
            security: [{ bearerAuth: [] }],
            parameters: [{
                name: 'userId',
                in: 'query',
                required: true,
                schema: { type: 'string', format: 'uuid' }
            }],
            responses: {
                200: {
                    content: {
                        'application/json': {
                            schema: { type: 'array', items: { $ref: '#/components/schemas/RendezVous' } }
                        }
                    }
                }
            }
        }
    }
};