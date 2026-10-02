module.exports = {
    '/course/add-course': {
        post: {
            tags: ['Courses'],
            summary: 'Create new course',
            security: [{ bearerAuth: [] }],
            requestBody: {
                content: {
                    'multipart/form-data': {
                        schema: {
                            type: 'object',
                            properties: {
                                files: { type: 'array', items: { type: 'string', format: 'binary' } },
                                nom: { type: 'string' },
                                prix: { type: 'number' },
                                niveau: { type: 'string' }
                            },
                            required: ['nom', 'prix', 'niveau']
                        }
                    }
                }
            },
            responses: {
                201: { $ref: '#/components/schemas/Course' },
                400: { $ref: '#/components/responses/400' },
                401: { $ref: '#/components/responses/401' }
            }
        }
    },
    '/course/all-courses': {
        get: {
            tags: ['Courses'],
            summary: 'Get all courses',
            responses: {
                200: {
                    content: {
                        'application/json': {
                            schema: { type: 'array', items: { $ref: '#/components/schemas/Course' } }
                        }
                    }
                }
            }
        }
    }
};