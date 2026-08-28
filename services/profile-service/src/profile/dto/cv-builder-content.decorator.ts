import {
  ValidationOptions,
  buildMessage,
  isObject,
  ValidateBy,
} from 'class-validator';

export const MAX_CV_BUILDER_CONTENT_BYTES = 1024 * 1024;
const MAX_DEPTH = 32;
const MAX_NODES = 20_000;
const MAX_KEY_LENGTH = 256;
const FORBIDDEN_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

const hasPostgresSafeUnicode = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0) {
      return false;
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (
        index + 1 >= value.length ||
        next < 0xdc00 ||
        next > 0xdfff
      ) {
        return false;
      }
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
};

const toJsonbNumberText = (value: number): string => {
  const serialized = JSON.stringify(value);
  if (!/[eE]/.test(serialized)) {
    return serialized;
  }
  const match = serialized.match(
    /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/,
  );
  if (!match) {
    return serialized;
  }
  const [, sign, integer, fraction = '', exponentText] = match;
  const digits = integer + fraction;
  const decimalIndex = integer.length + Number(exponentText);
  if (decimalIndex <= 0) {
    return `${sign}0.${'0'.repeat(-decimalIndex)}${digits}`;
  }
  if (decimalIndex >= digits.length) {
    return `${sign}${digits}${'0'.repeat(decimalIndex - digits.length)}`;
  }
  return `${sign}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
};

// PostgreSQL JSONB text adds spaces after separators and expands exponent-form
// numbers. The database size constraint measures that normalized form, so the
// API must use the same representation instead of compact JSON.stringify().
const jsonbTextByteLength = (value: unknown): number => {
  if (Array.isArray(value)) {
    return value.reduce(
      (bytes, item, index) =>
        bytes + (index === 0 ? 0 : 2) + jsonbTextByteLength(item),
      2,
    );
  }
  if (isPlainObject(value)) {
    return Object.entries(value).reduce(
      (bytes, [key, item], index) =>
        bytes +
        (index === 0 ? 0 : 2) +
        Buffer.byteLength(JSON.stringify(key), 'utf8') +
        2 +
        jsonbTextByteLength(item),
      2,
    );
  }
  if (typeof value === 'string') {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  }
  if (typeof value === 'number') {
    return Buffer.byteLength(toJsonbNumberText(value), 'utf8');
  }
  return value === null ? 4 : value ? 4 : 5;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  isObject(value) &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);

const hasSafeTreeShape = (root: Record<string, unknown>): boolean => {
  const stack: Array<{ value: unknown; depth: number }> = [
    { value: root, depth: 1 },
  ];
  let nodes = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || current.depth > MAX_DEPTH) {
      return false;
    }
    nodes += 1;
    if (nodes > MAX_NODES) {
      return false;
    }

    if (Array.isArray(current.value)) {
      for (const item of current.value) {
        stack.push({ value: item, depth: current.depth + 1 });
      }
      continue;
    }
    if (isPlainObject(current.value)) {
      for (const [key, value] of Object.entries(current.value)) {
        if (
          key.length === 0 ||
          key.length > MAX_KEY_LENGTH ||
          FORBIDDEN_KEYS.has(key) ||
          !hasPostgresSafeUnicode(key)
        ) {
          return false;
        }
        stack.push({ value, depth: current.depth + 1 });
      }
      continue;
    }
    if (current.value !== null) {
      if (typeof current.value === 'string') {
        if (!hasPostgresSafeUnicode(current.value)) {
          return false;
        }
      } else if (
        typeof current.value !== 'boolean' &&
        !(
          typeof current.value === 'number' &&
          Number.isFinite(current.value)
        )
      ) {
        return false;
      }
    }
  }
  return true;
};

const isValidCvBuilderContent = (value: unknown): boolean => {
  if (!isPlainObject(value) || !hasSafeTreeShape(value)) {
    return false;
  }
  try {
    return (
      jsonbTextByteLength(value) <= MAX_CV_BUILDER_CONTENT_BYTES
    );
  } catch {
    return false;
  }
};

export const IsCvBuilderContent = (
  validationOptions?: ValidationOptions,
): PropertyDecorator =>
  ValidateBy(
    {
      name: 'isCvBuilderContent',
      validator: {
        validate: isValidCvBuilderContent,
        defaultMessage: buildMessage(
          (eachPrefix) =>
            `${eachPrefix}$property must be a safe JSON object no larger than ${MAX_CV_BUILDER_CONTENT_BYTES} bytes`,
          validationOptions,
        ),
      },
    },
    validationOptions,
  );
