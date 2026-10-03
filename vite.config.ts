import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    {
      name: "tymba-local-workflow",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (!request.url?.startsWith("/api/")) return next();
          server
            .ssrLoadModule("/src/web-api/http.ts")
            .then((module) => module.handleWebApi(request, response))
            .catch(next);
        });
      },
    },
  ],
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  esbuild: { jsx: "automatic" },
  build: { outDir: "dist/web", emptyOutDir: true },
});
