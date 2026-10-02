module.exports = {
    '/rdv/create': {
        post: {
            tags: ['Rendez-vous'],
            summary: 'Create a new appointment',
            security: [{ BearerAuth: [] }],
            requestBody: {
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                disponibilite_id: { type: 'integer' },
                                id_eleve: { type: 'string', format: 'uuid' }
                            },
                            required: ['disponibilite_id', 'id_eleve']
                        }
                    }
                }
            },
            responses: {
                201: {
                    description: 'Appointment created',
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/RendezVous' }
                        }
                    }
                },
                400: { $ref: '#/components/responses/BadRequest' }
            }
        }
    },
    '/rdv/update/{id}': {
        put: {
            tags: ['Rendez-vous'],
            summary: 'Update appointment details',
            security: [{ BearerAuth: [] }],
            parameters: [{
                name: 'id',
                in: 'path',
                required: true,
                schema: { type: 'integer' }
            }],
            requestBody: {
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                date: { type: 'string', format: 'date' },
                                heure: { type: 'string' },
                                duree: { type: 'number' }
                            }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: 'Appointment updated',
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/RendezVous' }
                        }
                    }
                },
                404: { $ref: '#/components/responses/NotFound' }
            }
        }
    }
};