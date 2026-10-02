module.exports = {

    '/auth/register': {
        post: {
            tags: ['Authentication'],
            summary: 'Register new user',
            operationId: 'registerUser',
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
                            required: ['username', 'email', 'password']
                        }
                    }
                }
            },
            responses: {
                201: {
                    description: 'User created',
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    message: { type: 'string' },
                                    userId: { type: 'string', format: 'uuid' }
                                }
                            }
                        }
                    }
                },
                400: { $ref: '#/components/responses/400' },
                409: {
                    description: 'Conflict',
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/Error' }
                        }
                    }
                }
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
                                    refreshToken: { type: 'string' }
                                }
                            }
                        }
                    }
                },
                401: { description: 'Invalid credentials' }
            }
        }
    }
};