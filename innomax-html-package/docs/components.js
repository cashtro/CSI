module.exports = {
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT"
      }
    },
    schemas: {
      User: {
        type: "object",
        properties: {
          created_at: { type: "string", format: "date-time" },
          username: { type: "string" },
          age: { type: "number" },
          email: { type: "string", format: "email" },
          password: { type: "string", format: "password" },
          userid: { type: "string", format: "uuid" }
        }
      },

      Course: {
        type: "object",
        properties: {
          icon: { type: "integer" },
          nom: { type: "string" },
          prix: { type: "number" },
          niveau: { type: "string" },
          nombre_heures: { type: "integer" },
          id_prof: { type: "string", format: "uuid" },
          lesson_amount: { type: "integer" },
          lessons: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                type: { type: "string" },
                url: { type: "string" }
              }
            }
          },
          content: { type: "object" },
          created_at: { type: "string", format: "date-time" },
          about: { type: "string" },
          learning_points: { type: "array", items: { type: "string" } },
          program: { type: "array", items: { type: "string" } }
        },
      },
      RendezVous: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          disponibilite_id: { type: "string" },
          id_eleve: { type: "string", format: "uuid" },
          payment_id: { type: "string" },
          date: { type: "string", format: "date-time" },
          status: { type: "string" }
        }
      }
    },

    Error: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        error: { type: "string" },
        details: { type: "string" }
      }
    }
  },
  responses: {
    '400': {
      description: "Bad Request",
      content: {
        "application/json": {
          schema: {
            $ref: "#/components/schemas/Error"
          },
          example: {
            success: false,
            error: "Invalid request parameters",
            details: "Missing required field: username"
          }
        }
      }
    },
    '401': {
      description: "Unauthorized",
      content: {
        "application/json": {
          schema: {
            $ref: "#/components/schemas/Error"
          }
        }
      }
    }
  }
};