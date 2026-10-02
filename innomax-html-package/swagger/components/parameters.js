module.exports = {
    userIdParam: {
      name: 'userId',
      in: 'query',
      description: 'User ID',
      required: true,
      schema: { type: 'string' }
    },
    courseIdParam: {
      name: 'id',
      in: 'path',
      description: 'Course ID',
      required: true,
      schema: { type: 'string' }
    },
    rdvIdParam: {
      name: 'id',
      in: 'path',
      description: 'Rendez-vous ID',
      required: true,
      schema: { type: 'string' }
    }
  };