// Test configuration: local login, simulated email, no live sending.
process.env.APP_ENV = "test";
process.env.APP_BASE_URL = "http://localhost:3100";
process.env.AUTH_PROVIDER = "local";
process.env.ENCRYPTION_KEY = "dGVzdC1rZXktdGVzdC1rZXktdGVzdC1rZXktdGVzdDE="; // test-only, not a secret
process.env.SYSTEM_EMAIL_TRANSPORT = "dev-outbox";
process.env.DATABASE_URL ??= "postgres://bluewater_app:bluewater_app_local@localhost:5432/bluewater_test";
