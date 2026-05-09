/**
 * 가벼운 JSON Schema 검증기 — 우리 도구가 사용하는 부분 집합만 지원.
 *
 * 지원: type(string|integer|number|boolean|object), required, properties,
 *       additionalProperties, minimum, maximum, minLength, maxLength,
 *       enum, format=uri (간단)
 *
 * Claude가 보낸 input이 등록된 스키마와 안 맞으면 명확한 에러를 던져
 * tool.run() 진입 전에 거부한다.
 */

type SchemaProp = {
  type?: 'string' | 'integer' | 'number' | 'boolean' | 'object';
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  format?: string;
  description?: string;
};

type Schema = {
  type?: 'object';
  properties?: Record<string, SchemaProp>;
  required?: string[];
  additionalProperties?: boolean;
};

export function validateInput(schema: Record<string, unknown>, input: unknown): Record<string, unknown> {
  const s = schema as Schema;
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ValidationError('입력이 객체가 아닙니다');
  }
  const obj = input as Record<string, unknown>;

  const props = s.properties ?? {};
  const required = s.required ?? [];

  for (const k of required) {
    if (!(k in obj)) {
      throw new ValidationError(`필수 필드 누락: ${k}`);
    }
  }

  if (s.additionalProperties === false) {
    for (const k of Object.keys(obj)) {
      if (!(k in props)) {
        throw new ValidationError(`알 수 없는 필드: ${k}`);
      }
    }
  }

  for (const [k, v] of Object.entries(obj)) {
    const def = props[k];
    if (!def) continue;
    checkOne(k, v, def);
  }

  return obj;
}

function checkOne(key: string, value: unknown, def: SchemaProp) {
  if (def.type) {
    switch (def.type) {
      case 'string':
        if (typeof value !== 'string') throw new ValidationError(`${key}: 문자열이어야 합니다`);
        break;
      case 'integer':
        if (typeof value !== 'number' || !Number.isInteger(value))
          throw new ValidationError(`${key}: 정수여야 합니다`);
        break;
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value))
          throw new ValidationError(`${key}: 숫자여야 합니다`);
        break;
      case 'boolean':
        if (typeof value !== 'boolean') throw new ValidationError(`${key}: 불리언이어야 합니다`);
        break;
      case 'object':
        if (typeof value !== 'object' || value === null || Array.isArray(value))
          throw new ValidationError(`${key}: 객체여야 합니다`);
        break;
    }
  }
  if (def.enum && !def.enum.includes(value)) {
    throw new ValidationError(`${key}: 허용된 값이 아닙니다 (${JSON.stringify(def.enum)})`);
  }
  if (typeof value === 'number') {
    if (def.minimum !== undefined && value < def.minimum)
      throw new ValidationError(`${key}: ${def.minimum} 이상이어야 합니다`);
    if (def.maximum !== undefined && value > def.maximum)
      throw new ValidationError(`${key}: ${def.maximum} 이하여야 합니다`);
  }
  if (typeof value === 'string') {
    if (def.minLength !== undefined && value.length < def.minLength)
      throw new ValidationError(`${key}: 최소 ${def.minLength}자`);
    if (def.maxLength !== undefined && value.length > def.maxLength)
      throw new ValidationError(`${key}: 최대 ${def.maxLength}자`);
    if (def.format === 'uri') {
      try {
        new URL(value);
      } catch {
        throw new ValidationError(`${key}: URL 형식이 아닙니다`);
      }
    }
  }
}

export class ValidationError extends Error {
  readonly isValidation = true;
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
