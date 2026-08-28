const PLACEHOLDER = /replace-with|changeme|placeholder/i;
const UTC_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

const required = (
  environment: Record<string, unknown>,
  name: string,
): string => {
  const value = String(environment[name] ?? '').trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
};

const secret = (
  environment: Record<string, unknown>,
  name: string,
): string => {
  const value = required(environment, name);
  if (
    Buffer.byteLength(value, 'utf8') < 32 ||
    PLACEHOLDER.test(value) ||
    value !== String(environment[name])
  ) {
    throw new Error(
      `${name} must be a non-placeholder secret of at least 32 bytes`,
    );
  }
  return value;
};

export const validateEnvironment = (
  raw: Record<string, unknown>,
): Record<string, unknown> => {
  const environment = { ...raw };
  environment.DATABASE_URL = required(environment, 'DATABASE_URL');
  environment.JWT_ISSUER = required(environment, 'JWT_ISSUER');
  environment.JWT_AUDIENCE = required(environment, 'JWT_AUDIENCE');
  environment.NOTIFICATION_CURSOR_HMAC_KEY = secret(
    environment,
    'NOTIFICATION_CURSOR_HMAC_KEY',
  );

  const jwksUri = String(environment.JWT_JWKS_URI ?? '').trim();
  const publicKey = String(environment.JWT_PUBLIC_KEY ?? '').trim();
  const publicKeyPath = String(environment.JWT_PUBLIC_KEY_PATH ?? '').trim();
  if (!jwksUri && !publicKey && !publicKeyPath) {
    throw new Error(
      'JWT_JWKS_URI, JWT_PUBLIC_KEY or JWT_PUBLIC_KEY_PATH is required',
    );
  }
  if (
    jwksUri.startsWith('http://') &&
    String(environment.JWT_ALLOW_INSECURE_JWKS ?? '').toLowerCase() !== 'true'
  ) {
    throw new Error(
      'JWT_JWKS_URI must use HTTPS unless JWT_ALLOW_INSECURE_JWKS=true',
    );
  }

  const consumerEnabled =
    String(environment.NOTIFICATION_KAFKA_CONSUMER_ENABLED ?? 'true')
      .toLowerCase() !== 'false';
  environment.NOTIFICATION_KAFKA_CONSUMER_ENABLED = String(consumerEnabled);
  if (consumerEnabled) {
    environment.KAFKA_BROKERS = required(environment, 'KAFKA_BROKERS');
    if (
      String(environment.KAFKA_BROKERS)
        .split(',')
        .map((value) => value.trim())
        .some((value) => !value)
    ) {
      throw new Error('KAFKA_BROKERS is invalid');
    }
    environment.KAFKA_APPLICATION_TOPIC =
      String(environment.KAFKA_APPLICATION_TOPIC ?? 'application-events').trim();
    environment.KAFKA_INTERVIEW_TOPIC =
      String(environment.KAFKA_INTERVIEW_TOPIC ?? 'interview-events').trim();
    environment.KAFKA_NOTIFICATION_GROUP_ID = String(
      environment.KAFKA_NOTIFICATION_GROUP_ID ??
        'notification-application-inbox-v1',
    ).trim();
    environment.KAFKA_NOTIFICATION_INTERVIEW_GROUP_ID = String(
      environment.KAFKA_NOTIFICATION_INTERVIEW_GROUP_ID ??
        'notification-interview-inbox-v1',
    ).trim();
    kafkaName(environment, 'KAFKA_APPLICATION_TOPIC', 100);
    kafkaName(environment, 'KAFKA_INTERVIEW_TOPIC', 100);
    kafkaName(environment, 'KAFKA_NOTIFICATION_GROUP_ID', 249);
    kafkaName(environment, 'KAFKA_NOTIFICATION_INTERVIEW_GROUP_ID', 249);
    if (
      environment.KAFKA_APPLICATION_TOPIC ===
      environment.KAFKA_INTERVIEW_TOPIC
    ) {
      throw new Error('Kafka Application and Interview topics must be distinct');
    }
    if (
      environment.KAFKA_NOTIFICATION_GROUP_ID ===
      environment.KAFKA_NOTIFICATION_INTERVIEW_GROUP_ID
    ) {
      throw new Error('Kafka Application and Interview groups must be distinct');
    }
    environment.NOTIFICATION_APPLICATION_REPLAY_AFTER = replayCutoff(
      environment,
      'NOTIFICATION_APPLICATION_REPLAY_AFTER',
    );
    environment.NOTIFICATION_INTERVIEW_REPLAY_AFTER = replayCutoff(
      environment,
      'NOTIFICATION_INTERVIEW_REPLAY_AFTER',
    );
  }
  const maxPayload = Number(
    environment.NOTIFICATION_EVENT_MAX_BYTES ?? '65536',
  );
  if (!Number.isInteger(maxPayload) || maxPayload < 1024 || maxPayload > 262144) {
    throw new Error(
      'NOTIFICATION_EVENT_MAX_BYTES must be between 1024 and 262144',
    );
  }
  environment.NOTIFICATION_EVENT_MAX_BYTES = String(maxPayload);
  return environment;
};

const kafkaName = (
  environment: Record<string, unknown>,
  name: string,
  maxLength: number,
): void => {
  if (!new RegExp(`^[a-z0-9._-]{1,${maxLength}}$`).test(String(environment[name]))) {
    throw new Error(`${name} is invalid`);
  }
};

const replayCutoff = (
  environment: Record<string, unknown>,
  name: string,
): string => {
  const replayAfter = required(environment, name);
  if (!UTC_INSTANT.test(replayAfter)) {
    throw new Error(`${name} must be an exact UTC instant`);
  }
  const replayAfterDate = new Date(replayAfter);
  if (
    Number.isNaN(replayAfterDate.valueOf()) ||
    replayAfterDate.toISOString().slice(0, 19) !== replayAfter.slice(0, 19)
  ) {
    throw new Error(`${name} must be a valid UTC instant`);
  }
  return replayAfterDate.toISOString();
};
