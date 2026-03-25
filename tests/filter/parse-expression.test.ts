import { describe, expect, it } from 'bun:test';
import { parseFilterExpression } from '../../src/filter/parse-expression';

describe('parseFilterExpression', () => {
  describe('WHERE-only syntax', () => {
    it('parses WHERE clause', () => {
      expect(parseFilterExpression("WHERE resolvedType='solution'")).toEqual({
        where: "resolvedType='solution'",
      });
    });

    it('is case-insensitive for WHERE keyword', () => {
      expect(parseFilterExpression("where resolvedType='solution'")).toEqual({
        where: "resolvedType='solution'",
      });
      expect(parseFilterExpression("Where resolvedType='solution'")).toEqual({
        where: "resolvedType='solution'",
      });
    });

    it('trims whitespace from WHERE predicate', () => {
      expect(parseFilterExpression('WHERE   status = "active"   ')).toEqual({
        where: 'status = "active"',
      });
    });
  });

  describe('bare JSONata (no keyword prefix)', () => {
    it('treats bare JSONata as a WHERE predicate', () => {
      expect(parseFilterExpression("resolvedType='solution'")).toEqual({
        where: "resolvedType='solution'",
      });
    });

    it('treats complex bare JSONata as WHERE', () => {
      expect(parseFilterExpression("status='active' and $count(ancestors)>0")).toEqual({
        where: "status='active' and $count(ancestors)>0",
      });
    });
  });

  describe('SELECT + WHERE syntax', () => {
    it('parses SELECT and WHERE parts', () => {
      expect(parseFilterExpression("SELECT ancestors(opportunity) WHERE resolvedType='solution'")).toEqual({
        include: 'ancestors(opportunity)',
        where: "resolvedType='solution'",
      });
    });

    it('is case-insensitive for SELECT and WHERE keywords', () => {
      expect(parseFilterExpression("select ancestors WHERE resolvedType='solution'")).toEqual({
        include: 'ancestors',
        where: "resolvedType='solution'",
      });
    });

    it('handles multiple items in SELECT clause', () => {
      expect(parseFilterExpression("SELECT ancestors, siblings WHERE status='active'")).toEqual({
        include: 'ancestors, siblings',
        where: "status='active'",
      });
    });
  });

  describe('SELECT-only syntax', () => {
    it('parses SELECT clause without WHERE', () => {
      expect(parseFilterExpression('SELECT ancestors(opportunity)')).toEqual({
        include: 'ancestors(opportunity)',
      });
    });
  });

  describe('error cases', () => {
    it('throws on empty expression', () => {
      expect(() => parseFilterExpression('')).toThrow('must not be empty');
      expect(() => parseFilterExpression('   ')).toThrow('must not be empty');
    });

    it('throws on WHERE keyword with empty clause', () => {
      expect(() => parseFilterExpression('WHERE')).toThrow('WHERE clause must not be empty');
      expect(() => parseFilterExpression('WHERE   ')).toThrow('WHERE clause must not be empty');
    });

    it('throws on SELECT keyword with empty clause', () => {
      expect(() => parseFilterExpression('SELECT')).toThrow('SELECT clause must not be empty');
      expect(() => parseFilterExpression('SELECT   ')).toThrow('SELECT clause must not be empty');
    });

    it('throws on SELECT+WHERE with empty WHERE', () => {
      expect(() => parseFilterExpression('SELECT ancestors WHERE')).toThrow('WHERE clause must not be empty');
    });
  });
});
