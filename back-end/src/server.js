import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { readConfig } from "./config.js";
import { connectDatabase } from "./database.js";
import { createApp } from "./app.js";

dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)), quiet: true });

let database;
try {
  const config = readConfig();
  database = await connectDatabase(config);
  const app = createApp({ config, models: database.models });
  const server = app.listen(config.port, () => {
    console.log(`Authentication API listening on port ${config.port}; MongoDB connected.`);
  });
  server.on("error", async (error) => {
    console.error(`API server could not listen (${error.code || error.name}).`);
    await database.connection.close();
    process.exitCode = 1;
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      server.close(async () => { await database.connection.close(); process.exit(0); });
    });
  }
} catch (error) {
  // Driver errors may contain credentials. Print config errors, never driver messages.
  console.error(error.name === "Error" ? error.message : `MongoDB startup failed (${error.name}). Check credentials and Atlas network access.`);
  if (database) await database.connection.close();
  process.exitCode = 1;
}
