module.exports = {
    '/auth/register': {
        post: {
            tags: ['Authentication'],
            summary: 'Register new user',
            requestBody: {
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                username: { type: 'string' },
                                email: { type: 'string', format: 'email' },
                                age: { type: 'number' },
                                password: { type: 'string', format: 'password' }
                            },
                            required: ['email', 'password']
                        }
                    }
                }
            },
            responses: {
                201: {
                    description: 'User registered',
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    userid: { type: 'string', format: 'uuid' },
                                    email: { type: 'string' }
                                }
                            }
                        }
                    }
                },
                409: { $ref: '#/components/responses/Conflict' }
            }
        }
    },
    '/auth/login': {
        post: {
            tags: ['Authentication'],
            summary: 'User login',
            requestBody: {
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                email: { type: 'string', format: 'email' },
                                password: { type: 'string', format: 'password' }
                            },
                            required: ['email', 'password']
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: 'Login successful',
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    accessToken: { type: 'string' },
                                    refreshToken: { type: 'string' },
                                    user: { $ref: '#/components/schemas/User' }
                                }
                            }
                        }
                    }
                },
                401: { $ref: '#/components/responses/Unauthorized' }
            }
        }
    }
};