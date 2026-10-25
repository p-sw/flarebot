export {};

declare global {
  interface Env {
    SETUP_SECRET?: string;
    ENCRYPTION_KEY?: string;
    ALLOW_TEST_MAIL?: string;
    SMTP_HOST?: string;
    SMTP_PORT?: string;
    SMTP_SECURE?: string;
    SMTP_USER?: string;
    SMTP_PASSWORD?: string;
    MAIL_FROM?: string;
    MAIL_FROM_NAME?: string;
    TURNSTILE_SECRET_KEY?: string;
    TURNSTILE_SITE_KEY?: string;
    EMAIL?: SendEmail;
    TEST_MIGRATIONS?: { name: string; queries: string[] }[];
  }
}
