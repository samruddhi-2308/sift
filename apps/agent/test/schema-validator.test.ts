import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { SchemaValidator } from '../src/validation/schema-validator.js';

describe('SchemaValidator', () => {
  describe('Zod Schema Validation', () => {
    const ProductZod = z.object({
      name: z.string().min(1),
      price: z.number().positive(),
      inStock: z.boolean(),
    });

    it('passes for valid structured data', () => {
      const valid = { name: 'Wireless Headphones', price: 79.99, inStock: true };
      const res = SchemaValidator.validate(valid, ProductZod);
      expect(res.valid).toBe(true);
      expect(res.data).toEqual(valid);
      expect(res.errors).toBeUndefined();
    });

    it('generates descriptive error messages on failure', () => {
      const invalid = { name: '', price: -10, inStock: 'yes' };
      const res = SchemaValidator.validate(invalid, ProductZod);
      expect(res.valid).toBe(false);
      expect(res.errors).toBeDefined();
      expect(res.errors!.length).toBeGreaterThanOrEqual(2);
      expect(res.errors!.some((e) => e.includes('Field "name"'))).toBe(true);
      expect(res.errors!.some((e) => e.includes('Field "inStock"'))).toBe(true);
    });
  });

  describe('JSON Schema Validation', () => {
    const JsonSchema = {
      type: 'object',
      required: ['title', 'author', 'year'],
      properties: {
        title: { type: 'string' },
        author: { type: 'string' },
        year: { type: 'number' },
      },
    };

    it('passes when required fields match expected types', () => {
      const valid = { title: 'Design Patterns', author: 'Gang of Four', year: 1994 };
      const res = SchemaValidator.validate(valid, JsonSchema);
      expect(res.valid).toBe(true);
    });

    it('identifies missing required fields', () => {
      const missingYear = { title: 'Refactoring', author: 'Martin Fowler' };
      const res = SchemaValidator.validate(missingYear, JsonSchema);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain('Required field "year" is missing or empty.');
    });

    it('identifies type mismatches', () => {
      const badType = { title: 'Clean Code', author: 'Robert Martin', year: '2008' };
      const res = SchemaValidator.validate(badType, JsonSchema);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain('Field "year" must be a number, received string.');
    });
  });
});
