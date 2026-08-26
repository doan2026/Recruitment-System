import { Transform } from 'class-transformer';
import {
  buildMessage,
  ValidationOptions,
  ValidateBy,
} from 'class-validator';

export const CanonicalHttpsUrl = (): PropertyDecorator =>
  Transform(({ value }): unknown => {
    if (typeof value !== 'string') {
      return value;
    }

    const normalized = value.normalize('NFKC').trim();
    try {
      return new URL(normalized).toString();
    } catch {
      return normalized;
    }
  });

const isCanonicalHttpsUrl = (
  value: unknown,
  allowedHosts?: readonly string[],
): boolean => {
  if (typeof value !== 'string' || value.length > 2048) {
    return false;
  }

  try {
    const url = new URL(value);
    const validHost =
      !allowedHosts ||
      allowedHosts.some(
        (host) =>
          url.hostname === host || url.hostname === 'www.' + host,
      );

    return (
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      (url.port === '' || url.port === '443') &&
      validHost
    );
  } catch {
    return false;
  }
};

export const IsHttpsUrl = (
  validationOptions?: ValidationOptions,
): PropertyDecorator =>
  ValidateBy(
    {
      name: 'isHttpsUrl',
      validator: {
        validate: (value): boolean => isCanonicalHttpsUrl(value),
        defaultMessage: buildMessage(
          (eachPrefix) => eachPrefix + '$property must be a canonical HTTPS URL',
          validationOptions,
        ),
      },
    },
    validationOptions,
  );

export const IsHttpsUrlForHost = (
  host: string,
  validationOptions?: ValidationOptions,
): PropertyDecorator =>
  ValidateBy(
    {
      name: 'isHttpsUrlForHost',
      constraints: [host],
      validator: {
        validate: (value): boolean =>
          isCanonicalHttpsUrl(value, [host.toLowerCase()]),
        defaultMessage: buildMessage(
          (eachPrefix) =>
            eachPrefix + '$property must use HTTPS on ' + host,
          validationOptions,
        ),
      },
    },
    validationOptions,
  );
