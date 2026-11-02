/**
 * 가벼운 JSON Schema 검증기 — 우리 도구가 사용하는 부분 집합만 지원.
 *
 * 지원: type(string|integer|number|boolean|object|array), required, properties,
 *       additionalProperties, items, minItems, maxItems, minimum, maximum,
 *       minLength, maxLength, enum, format=uri (간단)
 *
 * Claude가 보낸 input이 등록된 스키마와 안 맞으면 명확한 에러를 던져
 * tool.run() 진입 전에 거부한다. 스트리밍 입력은 잘린 객체일 수 있으므로 반드시 거쳐야 한다.
 */

interface SchemaNode {
  type?: 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array';
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  format?: string;
  description?: string;
  properties?: Record<string, SchemaNode>;
  required?: string[];
  additionalProperties?: boolean;
  items?: SchemaNode;
  minItems?: number;
  maxItems?: number;
}

export class ValidationError extends Error {
  readonly isValidation = true;
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function validateInput(schema: Record<string, unknown>, input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ValidationError('입력이 객체가 아닙니다');
  }
  checkObject('', input as Record<string, unknown>, schema as SchemaNode);
  return input as Record<string, unknown>;
}

function join(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

function checkObject(path: string, obj: Record<string, unknown>, node: SchemaNode) {
  const props = node.properties ?? {};
  for (const key of node.required ?? []) {
    if (!(key in obj)) throw new ValidationError(`필수 필드 누락: ${join(path, key)}`);
  }
  if (node.additionalProperties === false) {
    for (const key of Object.keys(obj)) {
      if (!(key in props)) throw new ValidationError(`알 수 없는 필드: ${join(path, key)}`);
    }
  }
  for (const [key, value] of Object.entries(obj)) {
    const def = props[key];
    if (def) checkValue(join(path, key), value, def);
  }
}

function checkValue(path: string, value: unknown, def: SchemaNode) {
  switch (def.type) {
    case 'string':
      if (typeof value !== 'string') throw new ValidationError(`${path}: 문자열이어야 합니다`);
      break;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) throw new ValidationError(`${path}: 정수여야 합니다`);
      break;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new ValidationError(`${path}: 숫자여야 합니다`);
      break;
    case 'boolean':
      if (typeof value !== 'boolean') throw new ValidationError(`${path}: 불리언이어야 합니다`);
      break;
    case 'object':
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new ValidationError(`${path}: 객체여야 합니다`);
      }
      checkObject(path, value as Record<string, unknown>, def);
      break;
    case 'array':
      if (!Array.isArray(value)) throw new ValidationError(`${path}: 배열이어야 합니다`);
      if (def.minItems !== undefined && value.length < def.minItems) {
        throw new ValidationError(`${path}: 최소 ${def.minItems}개`);
      }
      if (def.maxItems !== undefined && value.length > def.maxItems) {
        throw new ValidationError(`${path}: 최대 ${def.maxItems}개`);
      }
      if (def.items) {
        const items = def.items;
        value.forEach((item, i) => checkValue(`${path}[${i}]`, item, items));
      }
      break;
  }
  if (def.enum && !def.enum.includes(value)) {
    throw new ValidationError(`${path}: 허용된 값이 아닙니다 (${JSON.stringify(def.enum)})`);
  }
  if (typeof value === 'number') {
    if (def.minimum !== undefined && value < def.minimum) throw new ValidationError(`${path}: ${def.minimum} 이상이어야 합니다`);
    if (def.maximum !== undefined && value > def.maximum) throw new ValidationError(`${path}: ${def.maximum} 이하여야 합니다`);
  }
  if (typeof value === 'string') {
    if (def.minLength !== undefined && value.length < def.minLength) throw new ValidationError(`${path}: 최소 ${def.minLength}자`);
    if (def.maxLength !== undefined && value.length > def.maxLength) throw new ValidationError(`${path}: 최대 ${def.maxLength}자`);
    if (def.format === 'uri') {
      try {
        new URL(value);
      } catch {
        throw new ValidationError(`${path}: URL 형식이 아닙니다`);
      }
    }
  }
}
