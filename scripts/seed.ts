import "dotenv/config";

// Phase 2 will load tests/fixtures/ariel-seed.json into the ariel_mock schema (architecture section 4.6).
async function main() {
  console.log("[db:seed] nothing to seed in Phase 1 (ariel_mock tables are created empty)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
