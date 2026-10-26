import { z, ZodError } from 'zod';

export interface ValidationResult {
  valid: boolean;
  data?: unknown;
  errors?: string[];
}

/**
 * Validates extracted data against a Zod schema or JSON Schema definition.
 */
export class SchemaValidator {
  /**
   * Validates data against a schema (ZodType or JSON Schema object).
   */
  static validate(data: unknown, schema?: unknown): ValidationResult {
    if (!schema) {
      // If no schema specified, any non-null object/value is valid
      if (data !== undefined && data !== null) {
        return { valid: true, data };
      }
      return { valid: false, errors: ['Extracted data is empty or null.'] };
    }

    // 1. Zod schema validation
    if (schema instanceof z.ZodType) {
      const parsed = schema.safeParse(data);
      if (parsed.success) {
        return { valid: true, data: parsed.data };
      }
      return {
        valid: false,
        errors: this.formatZodErrors(parsed.error),
      };
    }

    // 2. JSON Schema object validation
    if (typeof schema === 'object' && schema !== null) {
      return this.validateJsonSchema(data, schema as Record<string, unknown>);
    }

    return { valid: true, data };
  }

  private static formatZodErrors(error: ZodError): string[] {
    return error.errors.map((err) => {
      const path = err.path.length > 0 ? err.path.join('.') : 'root';
      return `Field "${path}": ${err.message}`;
    });
  }

  private static validateJsonSchema(data: unknown, schema: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];

    // Type validation
    if (schema.type === 'object') {
      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        return { valid: false, errors: [`Expected an object, but received ${Array.isArray(data) ? 'array' : typeof data}.`] };
      }

      const obj = data as Record<string, unknown>;

      // Check required fields
      if (Array.isArray(schema.required)) {
        for (const reqField of schema.required) {
          if (typeof reqField === 'string' && (obj[reqField] === undefined || obj[reqField] === null || obj[reqField] === '')) {
            errors.push(`Required field "${reqField}" is missing or empty.`);
          }
        }
      }

      // Check property types
      if (schema.properties && typeof schema.properties === 'object') {
        const props = schema.properties as Record<string, Record<string, unknown>>;
        for (const [key, propDef] of Object.entries(props)) {
          if (obj[key] !== undefined && propDef && propDef.type) {
            const val = obj[key];
            const expectedType = propDef.type;

            if (expectedType === 'string' && typeof val !== 'string') {
              errors.push(`Field "${key}" must be a string, received ${typeof val}.`);
            } else if (expectedType === 'number' && typeof val !== 'number') {
              errors.push(`Field "${key}" must be a number, received ${typeof val}.`);
            } else if (expectedType === 'boolean' && typeof val !== 'boolean') {
              errors.push(`Field "${key}" must be a boolean, received ${typeof val}.`);
            } else if (expectedType === 'array' && !Array.isArray(val)) {
              errors.push(`Field "${key}" must be an array, received ${typeof val}.`);
            }
          }
        }
      }
    } else if (schema.type === 'array') {
      if (!Array.isArray(data)) {
        return { valid: false, errors: [`Expected an array, received ${typeof data}.`] };
      }
      if (typeof schema.minItems === 'number' && data.length < schema.minItems) {
        errors.push(`Array must have at least ${schema.minItems} items (received ${data.length}).`);
      }
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return { valid: true, data };
  }
}
