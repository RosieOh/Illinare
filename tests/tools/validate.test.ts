import { describe, expect, it } from 'vitest';
import { ValidationError, validateInput } from '@/lib/tools/validate';

const schema = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 5 },
    level: { type: 'integer', minimum: 0, maximum: 100 },
    ratio: { type: 'number' },
    on: { type: 'boolean' },
    kind: { type: 'string', enum: ['a', 'b'] },
    url: { type: 'string', format: 'uri' },
    rows: {
      type: 'array',
      minItems: 1,
      maxItems: 2,
      items: {
        type: 'object',
        properties: { label: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } },
        required: ['label'],
        additionalProperties: false,
      },
    },
    inner: {
      type: 'object',
      properties: { x: { type: 'integer' } },
      required: ['x'],
    },
  },
  required: ['name'],
  additionalProperties: false,
};

const bad = (input: unknown) => () => validateInput(schema, input);

describe('validateInput', () => {
  it('accepts a valid object and returns it unchanged', () => {
    const input = {
      name: 'ok',
      level: 3,
      ratio: 0.5,
      on: true,
      kind: 'a',
      url: 'https://example.com',
      rows: [{ label: 'x', tags: ['t'] }],
      inner: { x: 1 },
    };
    expect(validateInput(schema, input)).toBe(input);
  });

  it('rejects non-objects', () => {
    expect(bad(null)).toThrow(ValidationError);
    expect(bad([])).toThrow(ValidationError);
    expect(bad('x')).toThrow(ValidationError);
  });

  it('checks required, unknown fields, and primitive types', () => {
    expect(bad({})).toThrow(/필수 필드 누락: name/);
    expect(bad({ name: 'a', other: 1 })).toThrow(/알 수 없는 필드: other/);
    expect(bad({ name: 1 })).toThrow(/문자열/);
    expect(bad({ name: 'a', level: 1.5 })).toThrow(/정수/);
    expect(bad({ name: 'a', ratio: Number.NaN })).toThrow(/숫자/);
    expect(bad({ name: 'a', on: 'yes' })).toThrow(/불리언/);
  });

  it('checks ranges, lengths, enums, and uri format', () => {
    expect(bad({ name: 'toolong' })).toThrow(/최대 5자/);
    expect(bad({ name: '' })).toThrow(/최소 1자/);
    expect(bad({ name: 'a', level: 101 })).toThrow(/100 이하/);
    expect(bad({ name: 'a', level: -1 })).toThrow(/0 이상/);
    expect(bad({ name: 'a', kind: 'c' })).toThrow(/허용된 값/);
    expect(bad({ name: 'a', url: 'not a url' })).toThrow(/URL/);
  });

  it('descends into arrays and nested objects with precise paths', () => {
    expect(bad({ name: 'a', rows: 'x' })).toThrow(/rows: 배열/);
    expect(bad({ name: 'a', rows: [] })).toThrow(/rows: 최소 1개/);
    expect(bad({ name: 'a', rows: [{ label: 'a' }, { label: 'b' }, { label: 'c' }] })).toThrow(/rows: 최대 2개/);
    expect(bad({ name: 'a', rows: [{}] })).toThrow(/필수 필드 누락: rows\[0\]\.label/);
    expect(bad({ name: 'a', rows: [{ label: 1 }] })).toThrow(/rows\[0\]\.label: 문자열/);
    expect(bad({ name: 'a', rows: [{ label: 'x', extra: 1 }] })).toThrow(/알 수 없는 필드: rows\[0\]\.extra/);
    expect(bad({ name: 'a', rows: [{ label: 'x', tags: [1] }] })).toThrow(/rows\[0\]\.tags\[0\]: 문자열/);
    expect(bad({ name: 'a', inner: {} })).toThrow(/필수 필드 누락: inner\.x/);
    expect(bad({ name: 'a', inner: [] })).toThrow(/inner: 객체/);
  });
});
