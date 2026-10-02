module.exports = {
    BadRequest: {
        description: 'Bad request - Invalid input data',
        content: {
            'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
                examples: {
                    invalidInput: {
                        value: {
                            error: 'Validation Error',
                            message: 'Missing required fields: email, password'
                        }
                    }
                }
            }
        }
    },
    Unauthorized: {
        description: 'Unauthorized - Invalid credentials',
        content: {
            'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
                examples: {
                    invalidCredentials: {
                        value: {
                            error: 'Authentication Failed',
                            message: 'Invalid email or password'
                        }
                    }
                }
            }
        }
    },
    NotFound: {
        description: 'Resource not found',
        content: {
            'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
                examples: {
                    notFound: {
                        value: {
                            error: 'Not Found',
                            message: 'Course with ID 123 not found'
                        }
                    }
                }
            }
        }
    },
    Conflict: {
        description: 'Resource conflict - Already exists',
        content: {
            'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
                examples: {
                    emailConflict: {
                        value: {
                            error: 'Conflict',
                            message: 'Email already registered'
                        }
                    }
                }
            }
        }
    },
    ServerError: {
        description: 'Internal server error',
        content: {
            'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
                examples: {
                    serverError: {
                        value: {
                            error: 'Server Error',
                            message: 'Unexpected error occurred'
                        }
                    }
                }
            }
        }
    }
};