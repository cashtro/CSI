module.exports = {
    '/course': {
      post: {
        tags: ['Courses'],
        summary: 'Create a new course with files',
        consumes: ['multipart/form-data'],
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'files',
            in: 'formData',
            description: 'Course files',
            type: 'array',
            items: { type: 'string', format: 'binary' }
          }
        ],
        requestBody: {
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  nom: { type: 'string' },
                  prix: { type: 'number' },
                  niveau: { type: 'string' },
                  nombre_heures: { type: 'integer' },
                  lessons: { 
                    type: 'string',
                    description: 'JSON string array of lessons'
                  },
                  content: { 
                    type: 'string',
                    description: 'JSON content object for potential wysiwyg text editors' 
                  }
                },
                required: ['nom', 'prix']
              }
            }
          }
        },
        responses: {
          201: {
            description: 'Course created successfully',
            content: {
              'application/json': { 
                schema: { $ref: '#/components/schemas/Course' }
              }
            }
          },
          400: { $ref: '#/components/responses/BadRequest' }
        }
      }
    },
    '/course/course-details/{id}': {
      get: {
        tags: ['Courses'],
        summary: 'Get info of a specific course with professor info',
        parameters: [{
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'integer' }
        }],
        responses: {
          200: {
            description: 'Course details',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Course'
                }
              }
            }
          },
          404: { $ref: '#/components/responses/NotFound' }
        }
      }
    }
  };