// Next's type augmentation marks NODE_ENV readonly; assign through a plain record for the test runtime.
const env = process.env as Record<string, string | undefined>;
env.NODE_ENV = "test";
env.DB_DRIVER = "pglite";
env.PGLITE_DATA_DIR = "memory://";
env.LOG_LEVEL = env.LOG_LEVEL ?? "silent";
env.SIN_PSEUDONYM_KEY = "a1".repeat(32);
env.SIN_ENC_KEY = "b2".repeat(32);
