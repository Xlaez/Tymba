import { createWebServer } from "./server.js";

createWebServer().listen(5173, "127.0.0.1", () => {
  process.stdout.write("Tymba local studio: http://127.0.0.1:5173\n");
});
