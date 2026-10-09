process.env.NODE_ENV = "test";
process.env.DB_DRIVER = "pglite";
process.env.PGLITE_DATA_DIR = "memory://";
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
process.env.SIN_PSEUDONYM_KEY = "a1".repeat(32);
process.env.SIN_ENC_KEY = "b2".repeat(32);
